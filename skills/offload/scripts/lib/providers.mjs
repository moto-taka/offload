import { rmSync } from 'node:fs';
import { CloudHTTP, remoteId } from './http.mjs';
import { cursorEnvironment, devinBlueprint } from './plan.mjs';
import { requireThat, fail, digest, repository, officialUrl, executable, run, redact } from './safety.mjs';
import { checkoutSnapshot } from './git.mjs';

const now = () => new Date().toISOString();
const reposOf = env => (env.repos || []).map(r => repository(r.url)).sort();
export function cursorPayload(job, prompt, binding, environment) {
  requireThat(binding.allowPromptGitGate, 'NEEDS_APPROVAL', 'Named Cursor environments require the explicit prompt-based commit gate.');
  return { agentId: `bc-${job.id.slice(4)}`, name: `offload:${job.id}`.slice(0,100), prompt: { text: prompt }, env: { type: 'cloud', name: environment.name }, mode: 'agent', workOnCurrentBranch: false, autoCreatePR: false };
}
export function devinPayload(job, prompt, binding) {
  return { prompt, title: `offload:${job.id}`, repos: [job.repository], ...(binding.createAsUserId ? { create_as_user_id: binding.createAsUserId } : {}) };
}
function claudeEnv() { const env={...process.env}; for(const k of Object.keys(env)) if(/(?:KEY|TOKEN|SECRET|PASSWORD|COOKIE|AUTHORIZATION)|^(?:ANTHROPIC_|CLAUDE_CODE_USE_|AWS_|GOOGLE_APPLICATION_CREDENTIALS)/i.test(k)) delete env[k]; return env; }
function receipt(provider, id, url, extra = {}) { return { provider, id: remoteId(id), url: officialUrl(url, provider), acceptedAt: now(), resultVerdict: 'UNVERIFIED', ...extra }; }
export class CursorAdapter {
  constructor(store, binding, options = {}) { this.store = store; this.binding = binding; this.http = new CloudHTTP('cursor', binding, options); }
  async authenticate() {
    const me = await this.http.request('GET', '/v1/me');
    requireThat(this.binding.expectedPrincipal && (String(me.userId) === this.binding.expectedPrincipal || me.userEmail === this.binding.expectedPrincipal), 'ACCOUNT_MISMATCH', 'Cursor user API key does not match expectedPrincipal. Service-account keys are not enabled in this release.');
  }
  async ensure(job, recipe) {
    const b = this.binding; await this.authenticate();
    requireThat(b.allowExperimental && b.environmentName, 'NEEDS_SETUP', 'Enable the verified v1 API binding and choose a dedicated environmentName.');
    const all = await this.http.pages('/v1/environments?limit=100');
    const matches = all.filter(e => e.name === b.environmentName);
    requireThat(matches.length <= 1, 'ENV_BINDING_AMBIGUOUS', 'Environment name is ambiguous.');
    let e = matches[0]; const config = cursorEnvironment(recipe), configHash = digest(config), key = `cursor:${b.id}`, previous = this.store.env(key);
    if (!e) {
      requireThat(b.allowEnvironmentCreate, 'NEEDS_SETUP', 'Environment does not exist; approve personal environment creation.');
      const payload = { owner: 'personal', name: b.environmentName, repos: [{ url: `https://github.com/${job.repository}` }], environmentJson: JSON.stringify(config) };
      e = await this.store.once(`${key}:create:${job.recipeHash}`, payload, () => this.http.request('POST', '/v1/environments', payload)); remoteId(e.id);
    }
    e = await this.http.request('GET', `/v1/environments/${remoteId(e.id)}`);
    requireThat(e.owner === 'personal' && e.name === b.environmentName && JSON.stringify(reposOf(e)) === JSON.stringify([job.repository]), 'ENV_BINDING_AMBIGUOUS', 'Expected a personal, single-repository environment.');
    let actual; try { actual = JSON.parse(e.environmentJson); } catch { fail('REMOTE_SCHEMA_CHANGED', 'Environment JSON is unavailable.'); }
    if (digest(actual) !== configHash) {
      requireThat(previous?.id === e.id && b.allowEnvironmentCreate && previous.configHash === digest(actual), 'ENVIRONMENT_REVIEW_REQUIRED', 'Existing environment differs; review it rather than overwriting another configuration.');
      const payload = { environmentJson: JSON.stringify(config) };
      await this.store.once(`${key}:update:${job.recipeHash}`, { ...payload, expectedVersion: e.versionId || e.updatedAt }, () => this.http.request('PATCH', `/v1/environments/${remoteId(e.id)}`, payload));
      e = await this.http.request('GET', `/v1/environments/${remoteId(e.id)}`);
      requireThat(digest(JSON.parse(e.environmentJson)) === configHash, 'ENVIRONMENT_CONFLICT', 'Environment changed during update.');
    }
    // Build completion is inspected separately; an existing old active image is not proof of this recipe.
    const builds = await this.http.pages(`/v1/environments/${remoteId(e.id)}/builds?limit=100`);
    const current = builds.filter(x => !x.draft && x.environmentId === e.id && Date.parse(x.createdAt) >= Date.parse(e.updatedAt)).sort((a,c) => Date.parse(c.createdAt)-Date.parse(a.createdAt))[0];
    const state = current?.status === 'SUCCEEDED' ? 'LAUNCHABLE' : current && ['FAILED','CANCELLED'].includes(current.status) ? 'FAILED' : 'BUILDING';
    const result = { id: e.id, name: e.name, configHash, recipeHash: job.recipeHash, revision: e.versionId || e.updatedAt, buildId: current?.id || null, state, gate: 'prompt-repository-commit-and-environment', observedAt: now() };
    this.store.saveEnv(key, result);
    requireThat(state === 'LAUNCHABLE', state === 'FAILED' ? 'ENVIRONMENT_FAILED' : 'ENVIRONMENT_BUILDING', 'Wait for a successful build of the current configuration; resume this job later.', { environment: result });
    return result;
  }
  async submit(job, prompt, environment) {
    const payload = cursorPayload(job, prompt, this.binding, environment), op = `${job.id}:task`, saved = this.store.operation(op);
    if (saved && saved.state !== 'DONE' && saved.state !== 'REJECTED') {
      const a = await this.http.request('GET', `/v1/agents/${payload.agentId}`);
      requireThat(a.id === payload.agentId && a.name === payload.name && a.env?.type === 'cloud' && a.env?.name === environment.name, 'SUBMISSION_UNKNOWN', 'Existing agent cannot be reconciled with this dispatch.');
      const recovered = receipt('cursor', a.id, a.url, { runId: remoteId(a.latestRunId) }); this.store.finishOperation(op, recovered); return recovered;
    }
    return this.store.once(op, payload, async () => {
      const r = await this.http.request('POST', '/v1/agents', payload);
      requireThat(r.agent?.id === payload.agentId && r.agent.env?.type === 'cloud' && r.run?.agentId === r.agent.id, 'INVALID_RECEIPT', 'Unexpected agent/run or execution location.');
      return receipt('cursor', r.agent.id, r.agent.url, { runId: remoteId(r.run.id) });
    });
  }
  async status(r) {
    await this.authenticate(); const result = await this.http.request('GET', `/v1/agents/${remoteId(r.id)}/runs/${remoteId(r.runId)}`);
    requireThat(result.id === r.runId && result.agentId === r.id, 'INVALID_RECEIPT', 'Run does not match the saved receipt.');
    return { remoteState: String(result.status || 'UNKNOWN'), result: typeof result.result === 'string' ? redact(result.result) : null, resultVerdict: 'UNVERIFIED' };
  }
}
export class DevinAdapter {
  constructor(store, binding, options = {}) { this.store = store; this.binding = binding; this.http = new CloudHTTP('devin', binding, options); }
  get base() { return `/v3beta1/organizations/${remoteId(this.binding.organizationId)}/snapshot-setup`; }
  async ensure(job, recipe) {
    const b = this.binding; requireThat(b.allowExperimental && b.allowSharedEnvironment && b.allowPromptGitGate, 'NEEDS_APPROVAL', 'Devin environment APIs affect an organization snapshot. Approve shared scope and the prompt-based commit gate.');
    // The service-user credential is required by the documented snapshot API. Never extract PAT/OAuth credentials.
    const list = await this.http.request('GET', `${this.base}/blueprints`);
    requireThat(Array.isArray(list.items) && !list.next_cursor && !list.nextCursor && !list.has_more, 'INCOMPLETE_DISCOVERY', 'Expected the complete blueprint list. Unknown pagination requires review.');
    const exposed = list.items.filter(x => x.repo_name).map(x => x.repo_name.toLowerCase());
    requireThat(exposed.every(r => b.approvedRepositories.includes(r)), 'SHARED_SCOPE_CHANGED', 'Organization snapshot contains an unapproved repository.');
    const candidates = list.items.filter(x => x.repo_name?.toLowerCase() === job.repository);
    requireThat(candidates.length <= 1, 'ENV_BINDING_AMBIGUOUS', 'Multiple repo blueprints match.');
    const key = `devin:${b.organizationId}:${b.repository}`, previous = this.store.env(key), contents = devinBlueprint(recipe);
    const scopeHash = digest(list.items.map(x => ({ id: x.blueprint_id, updated: x.updated_at, repo: x.repo_name })).sort((a,c) => a.id.localeCompare(c.id)));
    if (previous && previous.recipeHash === job.recipeHash && previous.scopeHash === scopeHash && previous.buildId) {
      const build = await this.http.request('GET', `${this.base}/builds/${remoteId(previous.buildId)}`);
      const state = build.status === 'succeeded' ? 'LAUNCHABLE' : ['failed','cancelled'].includes(build.status) ? 'FAILED' : 'BUILDING';
      const result = { ...previous, state, observedAt: now() }; this.store.saveEnv(key,result);
      requireThat(state === 'LAUNCHABLE', state === 'FAILED' ? 'ENVIRONMENT_FAILED' : 'ENVIRONMENT_BUILDING', 'Devin build is not ready.', { environment: result }); return result;
    }
    requireThat(!candidates.length, 'ENVIRONMENT_REVIEW_REQUIRED', 'An existing or externally changed Devin blueprint requires manual review; this release does not overwrite shared blueprints.');
    requireThat(b.allowEnvironmentCreate, 'NEEDS_SETUP', 'Approve repository blueprint creation and organization build.');
    const payload = { repo_name: job.repository, contents };
    const blueprint = await this.store.once(`${key}:create:${job.recipeHash}`, payload, () => this.http.request('POST', `${this.base}/blueprints`, payload)); remoteId(blueprint.blueprint_id);
    const fresh = await this.http.request('GET', `${this.base}/blueprints`);
    requireThat(Array.isArray(fresh.items) && !fresh.next_cursor && !fresh.nextCursor && fresh.items.filter(x=>x.repo_name).every(x=>b.approvedRepositories.includes(x.repo_name.toLowerCase())), 'SHARED_SCOPE_CHANGED', 'Snapshot repository scope changed.');
    const build = await this.store.once(`${key}:build:${job.recipeHash}`, { blueprintId: blueprint.blueprint_id, contentsHash: digest(contents) }, () => this.http.request('POST', `${this.base}/builds`, {}));
    const result = { id: blueprint.blueprint_id, recipeHash: job.recipeHash, buildId: remoteId(build.build_id), scopeHash: digest(fresh.items.map(x=>({ id:x.blueprint_id, updated:x.updated_at, repo:x.repo_name })).sort((a,c)=>a.id.localeCompare(c.id))), state: 'BUILDING', gate: 'prompt-repository-commit-and-snapshot', observedAt: now() };
    this.store.saveEnv(key, result); fail('ENVIRONMENT_BUILDING', 'Blueprint registered and build requested once. Resume after it finishes.', { environment: result });
  }
  async submit(job, prompt) {
    const b = this.binding, payload = devinPayload(job,prompt,b);
    return this.store.once(`${job.id}:task`, payload, async () => {
      const r = await this.http.request('POST', `/v3/organizations/${remoteId(b.organizationId)}/sessions`, payload);
      requireThat(r.org_id === b.organizationId && (!b.createAsUserId || r.user_id === b.createAsUserId), 'ACCOUNT_MISMATCH', 'Returned session principal or organization differs.');
      return receipt('devin',r.session_id,r.url);
    });
  }
  async status(r) {
    const s = await this.http.request('GET', `/v3/organizations/${remoteId(this.binding.organizationId)}/sessions/${remoteId(r.id)}`);
    requireThat(s.session_id === r.id && s.org_id === this.binding.organizationId, 'INVALID_RECEIPT', 'Session identity changed.');
    return { remoteState: String(s.status || s.status_enum || s.status_detail || 'UNKNOWN'), result: s.structured_output ? redact(JSON.stringify(s.structured_output)) : null, resultVerdict: 'UNVERIFIED' };
  }
}
export class ClaudeAdapter {
  constructor(store,binding,{ runFn = run } = {}) { this.store=store; this.binding=binding; this.runFn=runFn; }
  async ensure(job) {
    const b=this.binding;
    requireThat(b.claudeCloudVerified && b.allowExperimental && b.allowSnapshotBundle, 'NEEDS_SETUP', 'Verify claude.ai managed Cloud/account and explicitly allow only the isolated snapshot bundle.');
    const binary=executable(b.cliPath || 'claude',job.root), version=this.runFn(binary,['--version']);
    const m=version.match(/\b(\d+)\.(\d+)\.(\d+)\b/);
    requireThat(m && (+m[1]>2 || +m[1]===2 && (+m[2]>1 || +m[2]===1 && +m[3]>=224)), 'CLI_VERSION_UNSUPPORTED', 'Claude >=2.1.224 is required by the tested dispatch contract.');
    let auth; try{auth=JSON.parse(this.runFn(binary,['auth','status'],{env:claudeEnv()}));}catch{fail('NEEDS_AUTH','Could not read official Claude auth status JSON.');}
    requireThat(auth.loggedIn===true && auth.email && b.expectedPrincipal===auth.email && auth.authMethod==='oauth', 'ACCOUNT_MISMATCH', 'Claude must report the expected logged-in claude.ai OAuth account. Review changed auth-status schemas before enabling them.');
    return { id:b.environmentId || null, state:'LAUNCHABLE', gate:'managed-cloud-account-and-code', version:m[0], observedAt:now() };
  }
  async submit(job,prompt) {
    const b=this.binding, binary=executable(b.cliPath || 'claude',job.root);
    const args=b.environmentId ? ['--bare','-p',prompt,'--environment',b.environmentId,'--ref',job.snapshot.ref.replace('refs/heads/',''),'--output-format','json'] : ['--bare','--cloud',prompt];
    return this.store.once(`${job.id}:task`, { binary,args,commit:job.snapshot.commit }, async () => {
      const cwd=checkoutSnapshot(this.store,this.store.read(job.id,'manifest.json'),job.snapshot);
      const env=claudeEnv();
      try {
        const output=this.runFn(binary,args,{cwd,env,timeout:120_000}); let parsed;
        if(b.environmentId) { try { parsed=JSON.parse(output); } catch { fail('INVALID_RECEIPT','CLI did not return the documented JSON receipt.'); } }
        else { const urls=output.match(/https:\/\/claude\.ai\/code\/[A-Za-z0-9_-]+/g) || []; requireThat(urls.length===1,'INVALID_RECEIPT','No unique managed Cloud session URL was returned.'); parsed={session_id:urls[0].split('/').pop(),url:urls[0]}; }
        return receipt('claude',parsed.session_id,parsed.url || parsed.session_url);
      } finally { rmSync(cwd,{recursive:true,force:true}); }
    });
  }
  async status() { return {remoteState:'UNKNOWN',result:null,resultVerdict:'UNVERIFIED',note:'Use the official Cloud session view; this adapter does not infer managed Cloud progress.'}; }
}
export function adapter(store,binding,options) {
  if(binding.provider==='cursor') return new CursorAdapter(store,binding,options);
  if(binding.provider==='devin') return new DevinAdapter(store,binding,options);
  if(binding.provider==='claude') return new ClaudeAdapter(store,binding,options);
  fail('NEEDS_UI_DRIVER','New Codex Cloud uses the host browser workflow. See references/codex-ui.md.');
}
