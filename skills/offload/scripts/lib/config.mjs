import { existsSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { readJson, saveJson, requireThat, slug, digest } from './safety.mjs';

export const providers = ['codex','claude','cursor','devin'];
export const flavors = { codex: 'codex_new_ui', claude: 'claude_managed_cli', cursor: 'cursor_cloud_api_v1', devin: 'devin_cloud_api_v3' };
const allowedBinding = new Set(['id','provider','repository','accountLabel','enabled','flavor','credentialEnv','expectedPrincipal','cliPath','environmentId','environmentName','organizationId','createAsUserId','approvedRepositories','allowDraftPr','allowExperimental','allowEnvironmentCreate','allowSharedEnvironment','allowSnapshotPush','allowPromptGitGate','claudeCloudVerified','allowSnapshotBundle','autoApprove','approvedRecipeHashes']);
const boolFields = ['enabled','allowDraftPr','allowExperimental','allowEnvironmentCreate','allowSharedEnvironment','allowSnapshotPush','allowPromptGitGate','claudeCloudVerified','allowSnapshotBundle','autoApprove'];
export const defaultConfig = () => ({ version: 1, defaults: {}, bindings: [] });
export function validateConfig(c) {
  requireThat(c && c.version === 1 && c.defaults && Array.isArray(c.bindings) && Object.keys(c).every(k => ['version','defaults','bindings'].includes(k)), 'BAD_CONFIG', 'Expected config version 1 with defaults and bindings.');
  for (const [k,v] of Object.entries(c.defaults)) requireThat(['pi','opencode','unknown'].includes(k) && providers.includes(v), 'BAD_CONFIG', 'Invalid default target.');
  const ids = new Set();
  for (const b of c.bindings) {
    requireThat(b && Object.keys(b).every(k => allowedBinding.has(k)) && /^[a-zA-Z0-9_-]+$/.test(b.id || '') && !ids.has(b.id), 'BAD_CONFIG', 'Invalid or duplicate binding.'); ids.add(b.id);
    requireThat(providers.includes(b.provider) && b.flavor === flavors[b.provider] && typeof b.accountLabel === 'string' && b.accountLabel.length > 0, 'BAD_CONFIG', 'Invalid provider/account/flavor; legacy and self-hosted are not supported.');
    requireThat(slug(b.repository) === b.repository, 'BAD_CONFIG', 'Use lowercase owner/repository.');
    for (const k of boolFields) if (k in b) requireThat(typeof b[k] === 'boolean', 'BAD_CONFIG', `Expected boolean ${k}.`);
    for (const k of ['credentialEnv']) if (b[k]) requireThat(/^[A-Z][A-Z0-9_]*$/.test(b[k]), 'BAD_CONFIG', 'Store the credential environment variable NAME, not its value.');
    for (const k of ['environmentId','organizationId','createAsUserId']) if (b[k]) requireThat(/^[A-Za-z0-9_-]{1,200}$/.test(b[k]), 'BAD_CONFIG', 'Invalid provider identifier.');
    if (b.cliPath) requireThat(path.isAbsolute(b.cliPath), 'BAD_CONFIG', 'CLI path must be absolute.');
    if (b.expectedPrincipal) requireThat(typeof b.expectedPrincipal === 'string' && b.expectedPrincipal.length <= 255, 'BAD_CONFIG', 'Invalid principal.');
    if (b.environmentName) requireThat(typeof b.environmentName === 'string' && b.environmentName.length <= 200 && !/[\x00-\x1f]/.test(b.environmentName), 'BAD_CONFIG', 'Invalid environment name.');
    requireThat(Array.isArray(b.approvedRepositories) && b.approvedRepositories.includes(b.repository), 'BAD_CONFIG', 'Binding must explicitly allow its repository.');
    b.approvedRepositories.forEach(slug);
    requireThat(Array.isArray(b.approvedRecipeHashes) && b.approvedRecipeHashes.every(h => /^[a-f0-9]{64}$/.test(h)), 'BAD_CONFIG', 'Invalid approved recipe hashes.');
  }
  return c;
}
export function loadConfig(root) {
  const file = path.join(root, 'config.json');
  if (!existsSync(file)) return defaultConfig();
  if (process.platform !== 'win32') requireThat((lstatSync(file).mode & 0o077) === 0, 'INSECURE_CONFIG', 'Set config.json permissions to 0600.');
  return validateConfig(readJson(file));
}
export const saveConfig = (root, config) => saveJson(path.join(root, 'config.json'), validateConfig(config));
export function resolveTarget(host, explicit, config) {
  if (explicit) { requireThat(providers.includes(explicit), 'INVALID_TARGET', 'Target must be codex, claude, cursor, or devin.'); return explicit; }
  const target = { codex: 'codex', 'claude-code': 'claude', claude: 'claude', cursor: 'cursor' }[host] || config.defaults[host];
  requireThat(target, 'NEEDS_TARGET', 'Choose one cloud target. The current model does not determine it.'); return target;
}
export function bindingFor(config, repo, provider) {
  const matches = config.bindings.filter(b => b.provider === provider && b.repository === repo && b.enabled);
  requireThat(matches.length === 1, matches.length ? 'AMBIGUOUS_ACCOUNT' : 'NEEDS_SETUP', matches.length ? 'More than one enabled binding matches. Select one in trusted config.' : 'Run setup for this repository/provider.');
  return matches[0];
}
export function newBinding(provider, repo) {
  requireThat(providers.includes(provider), 'INVALID_TARGET', 'Unknown cloud.');
  return { id: `${provider}-${repo.replace('/','-').replaceAll('.','-')}`, provider, repository: repo, accountLabel: 'SET_ME', enabled: false, flavor: flavors[provider], credentialEnv: provider === 'cursor' ? 'CURSOR_API_KEY' : provider === 'devin' ? 'DEVIN_API_KEY' : undefined, environmentName: `offload-${repo.replace('/','-')}-development`, approvedRepositories: [repo], allowDraftPr: false, allowExperimental: false, allowEnvironmentCreate: false, allowSharedEnvironment: false, allowSnapshotPush: false, allowPromptGitGate: false, claudeCloudVerified: false, allowSnapshotBundle: false, autoApprove: false, approvedRecipeHashes: [] };
}
export function approvalHash(job, binding) {
  return digest({ plan: job.planHash, recipe: job.recipeHash, manifest: job.manifestHash, provider: job.provider, repository: job.repository, binding });
}
export function parseOffload(text) {
  requireThat(typeof text === 'string', 'INVALID_COMMAND', 'Command must be text.');
  const tokens = text.trim().replace(/^\/offload(?:\s+|$)/, '').split(/\s+/).filter(Boolean);
  const result = { target: null, preview: false, action: 'prepare', jobId: null, instruction: '' };
  if (['setup','status','resume'].includes(tokens[0])) {
    result.action = tokens.shift();
    if (result.action === 'setup') result.target = tokens.shift() || null; else result.jobId = tokens.shift() || null;
    requireThat(!tokens.length, 'INVALID_COMMAND', 'Unexpected arguments.');
    if (result.target) requireThat(providers.includes(result.target), 'INVALID_TARGET', 'Unknown cloud target.');
    return result;
  }
  const words = [];
  while (tokens.length) {
    const t = tokens.shift();
    if (t === '--') { words.push(...tokens); break; }
    if (t === '--preview') { result.preview = true; continue; }
    requireThat(!t.startsWith('-'), 'INVALID_OPTION', 'Unknown option. --local is deliberately unsupported.');
    if (!words.length && providers.includes(t)) { requireThat(!result.target, 'MULTIPLE_TARGETS', 'Only one cloud target is allowed.'); result.target = t; }
    else { requireThat(t !== 'pi' || words.length > 0, 'INVALID_TARGET', 'Pi is a source, not an offload destination.'); words.push(t); }
  }
  result.instruction = words.join(' '); return result;
}
