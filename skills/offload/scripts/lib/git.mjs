import { readFileSync, lstatSync, existsSync, realpathSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { executable, run, requireThat, repository, digest, relativePath, scanSecrets, secretFile, privateDir, inside, fail } from './safety.mjs';

export function git(cwd, args, options = {}) {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' };
  for (const k of Object.keys(env)) if (/^GIT_(?:DIR|WORK_TREE|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|CONFIG|SSH_COMMAND)/.test(k)) delete env[k];
  Object.assign(env, options.env || {});
  return run(options.binary || executable('git', cwd), ['-c','core.fsmonitor=false','-c','core.hooksPath=' + (process.platform === 'win32' ? 'NUL' : '/dev/null'), ...args], { ...options, env, cwd });
}
export function capture(cwd) {
  const root = realpathSync(git(cwd, ['rev-parse','--show-toplevel']));
  const head = git(root, ['rev-parse','HEAD']);
  requireThat(/^[a-f0-9]{40,64}$/.test(head), 'GIT_EMPTY', 'Commit the repository before offloading.');
  const remote = git(root, ['remote','get-url','origin']); const repo = repository(remote);
  const pushRemote = git(root, ['remote','get-url','--push','origin']);
  requireThat(repository(pushRemote) === repo, 'REMOTE_MISMATCH', 'Origin fetch/push repositories differ.');
  const entries = git(root, ['ls-files','--stage','-z']).split('\0').filter(Boolean);
  const tracked = new Set();
  for (const entry of entries) {
    const m = /^(\d+) ([a-f0-9]+) (\d)\t([\s\S]+)$/.exec(entry);
    requireThat(m && m[3] === '0', 'GIT_CONFLICT', 'Resolve Git conflicts before offloading.');
    requireThat(['100644','100755'].includes(m[1]), 'UNSUPPORTED_FILE', 'Submodules and symbolic links are not exported.'); tracked.add(m[4]);
  }
  const untracked = git(root, ['ls-files','--others','--exclude-standard','-z']).split('\0').filter(Boolean);
  const names = [...new Set([...tracked, ...untracked])].sort();
  requireThat(names.length <= 10_000, 'EXPORT_TOO_LARGE', 'More than 10,000 files; narrow the repository before export.');
  const files = [], deleted = [], lower = new Set(); let bytes = 0;
  for (const name of names) {
    relativePath(name);
    requireThat(!lower.has(name.toLowerCase()), 'CASE_COLLISION', 'Case-colliding filenames cannot be exported portably.'); lower.add(name.toLowerCase());
    requireThat(!secretFile(name) && name !== '.gitmodules', 'SECRET_FILE', 'Credential or unsupported repository metadata file cannot be exported.', { location: name });
    const full = path.join(root, name);
    if (!existsSync(full)) { if (tracked.has(name)) deleted.push(name); continue; }
    const stat = lstatSync(full);
    requireThat(!stat.isSymbolicLink() && stat.isFile() && inside(root, realpathSync(full)), 'UNSAFE_PATH', 'Export paths must be regular files inside the repository.');
    requireThat(stat.size <= 5 * 1024 * 1024, 'EXPORT_TOO_LARGE', 'A file exceeds 5 MiB.', { location: name });
    const data = readFileSync(full); bytes += data.length;
    requireThat(bytes <= 20 * 1024 * 1024, 'EXPORT_TOO_LARGE', 'Export exceeds 20 MiB.');
    const after = lstatSync(full); requireThat(stat.mtimeMs === after.mtimeMs && stat.size === after.size, 'SOURCE_CHANGED', 'A file changed while being captured.');
    scanSecrets(data, name);
    if (name.endsWith('.gitattributes')) requireThat(!/filter\s*=\s*lfs/.test(data.toString()), 'LFS_UNSUPPORTED', 'Git LFS exports require a dedicated implementation.');
    files.push({ path: name, mode: (stat.mode & 0o111) ? '100755' : '100644', hash: digest(data), bytes: data.length, untracked: !tracked.has(name), data: data.toString('base64') });
  }
  let branch = null; try { branch = git(root, ['symbolic-ref','--quiet','--short','HEAD']); } catch {}
  const fingerprint = digest({ head, branch, repo, files: files.map(({ data, ...f }) => f), deleted });
  return { root, head, branch, repository: repo, remote, fingerprint, files, deleted, totalBytes: bytes };
}
export function verifyCapture(saved) {
  const current = capture(saved.root);
  requireThat(current.fingerprint === saved.fingerprint, 'SOURCE_CHANGED', 'Repository changed after planning. Prepare a new job; the saved plan is not silently rebound.'); return current;
}
export function inspectRecipe(manifest) {
  const byPath = new Map(manifest.files.map(f => [f.path, f]));
  if (!byPath.has('package.json')) return { recipe: null, reason: 'Automatic recipe detection currently supports Node projects. Supply a reviewed v2.0 EnvironmentRecipe for other stacks.' };
  let pkg; try { pkg = JSON.parse(Buffer.from(byPath.get('package.json').data, 'base64').toString('utf8')); } catch { return { recipe: null, reason: 'package.json is invalid.' }; }
  const matches = [['pnpm','pnpm-lock.yaml'],['npm','package-lock.json'],['yarn','yarn.lock'],['bun','bun.lock']].filter(([, f]) => byPath.has(f));
  if (matches.length !== 1) return { recipe: null, reason: 'Exactly one recognized lockfile is needed for automatic environment generation.' };
  const [manager, lock] = matches[0], source = ['package.json',lock];
  const runtimes = [];
  for (const f of ['.node-version','.nvmrc']) if (byPath.has(f)) { source.push(f); runtimes.push({ name: 'node', version_requirement: Buffer.from(byPath.get(f).data,'base64').toString().trim(), source_refs: [f] }); break; }
  if (!runtimes.length && pkg.engines?.node) runtimes.push({ name:'node',version_requirement:pkg.engines.node,source_refs:['package.json'] });
  const pmVersion = typeof pkg.packageManager === 'string' && pkg.packageManager.startsWith(manager + '@') ? pkg.packageManager.slice(manager.length + 1) : 'repository lockfile compatible; verify in cloud';
  const command = (label, argv) => ({label,argv,cwd:'.',source_refs:['package.json',lock]});
  const prefix = ['pnpm','yarn'].includes(manager) ? ['corepack', manager] : [manager];
  const installArgs = manager === 'npm' ? ['npm','ci'] : manager === 'yarn' ? [...prefix, 'install', /^(?:[2-9]|[1-9][0-9])\./.test(pmVersion) ? '--immutable' : '--frozen-lockfile'] : [...prefix,'install','--frozen-lockfile'];
  return { recipe: { schema_version:'2.0',profile:'development',source_commit:manifest.head,platform:{os_family:'linux',distribution_hint:null},runtimes,package_manager:{name:manager,version_requirement:pmVersion,lockfiles:[lock]},install:[command('Install locked dependencies',installArgs)],start:[],health_checks:[command('Check Node runtime',['node','--version'])],tests:['typecheck','lint','test'].filter(k => pkg.scripts?.[k]).map(k => command(`Run ${k}`, [...prefix, 'run', k])),required_secret_names:[],public_network_requirements:[{hostname:'registry.npmjs.org',purpose:'Install locked dependencies'}],source_refs:source,unresolved:[] }, reason: null };
}
export function remoteHead(manifest, ref) {
  const output = git(manifest.root, ['ls-remote', '--refs', manifest.remote, ref]);
  const rows = output.split('\n').filter(Boolean).map(r => r.split(/\s+/));
  requireThat(rows.length <= 1, 'REMOTE_AMBIGUOUS', 'Remote ref did not resolve uniquely.');
  return rows[0]?.[0] || null;
}
// Publish a reviewed tree without staging, stashing, resetting, or committing in the user's worktree.
// Unpushed history is intentionally flattened on top of a fetched remote base, avoiding accidental history export.
export function publishSnapshot(store, job, manifest, binding) {
  requireThat(binding.allowSnapshotPush, 'NEEDS_APPROVAL', 'Enable snapshot pushes for this exact repository/account before dispatch.');
  verifyCapture(manifest);
  const ref = `refs/heads/offload/${job.id}`;
  if (job.snapshot?.commit) {
    requireThat(remoteHead(manifest, ref) === job.snapshot.commit, 'REMOTE_MISMATCH', 'Published snapshot ref changed or is missing.'); return job.snapshot;
  }
  const old = store.operation(`${job.id}:git-push`);
  if (old && old.state !== 'REJECTED') {
    const prepared = store.read(job.id, 'snapshot-intent.json');
    const seen = remoteHead(manifest, ref);
    if (seen === prepared.commit) { store.finishOperation(`${job.id}:git-push`, prepared); return prepared; }
    fail('SUBMISSION_UNKNOWN', 'Snapshot push may have occurred. Inspect the saved ref; do not push again automatically.');
  }
  requireThat(!remoteHead(manifest, ref), 'REMOTE_CONFLICT', 'Snapshot ref already exists and is not owned by this operation.');
  const temp = mkdtempSync(path.join(privateDir(path.join(store.root,'scratch')), 'publish-'));
  try {
    git(temp, ['init','--quiet']);
    const selectedRef = manifest.branch ? `refs/heads/${manifest.branch}` : 'HEAD';
    const advertised = git(manifest.root, ['ls-remote',manifest.remote,selectedRef]);
    const base = advertised.trim() ? selectedRef : 'HEAD';
    git(temp, ['fetch','--no-tags','--depth=1',manifest.remote,base]);
    const parent = git(temp, ['rev-parse','FETCH_HEAD']);
    git(temp, ['read-tree','--empty']);
    const index = [];
    for (const f of manifest.files) {
      const data = Buffer.from(f.data,'base64'); requireThat(digest(data) === f.hash, 'ARTIFACT_CHANGED', 'Captured file hash mismatch.');
      const blob = git(temp,['hash-object','-w','--stdin','--no-filters'],{input:data}); index.push(`${f.mode} ${blob}\t${f.path}\0`);
    }
    git(temp, ['update-index','-z','--index-info'], { input:index.join('') });
    const tree = git(temp,['write-tree']);
    const commit = git(temp,['commit-tree',tree,'-p',parent],{input:`Offload snapshot ${job.id}\n`,env:{GIT_AUTHOR_NAME:'Offload',GIT_AUTHOR_EMAIL:'offload@users.noreply.github.com',GIT_COMMITTER_NAME:'Offload',GIT_COMMITTER_EMAIL:'offload@users.noreply.github.com'}});
    const snapshot = { commit, ref, baseCommit:parent, history:'flattened-reviewed-tree', repository:manifest.repository };
    store.artifact(job.id,'snapshot-intent.json',snapshot);
    store.startOperation(`${job.id}:git-push`,snapshot);
    git(temp,['push','--porcelain',manifest.remote,`${commit}:${ref}`]);
    requireThat(remoteHead(manifest,ref) === commit,'REMOTE_MISMATCH','Snapshot push read-back did not match.');
    store.finishOperation(`${job.id}:git-push`,snapshot); return snapshot;
  } finally { rmSync(temp,{recursive:true,force:true}); }
}
export function checkoutSnapshot(store, manifest, snapshot) {
  const temp = mkdtempSync(path.join(privateDir(path.join(store.root,'scratch')), 'dispatch-'));
  try {
    git(temp,['init','--quiet']); git(temp,['remote','add','origin',manifest.remote]);
    git(temp,['fetch','--no-tags','--depth=1','origin',snapshot.ref]);
    requireThat(git(temp,['rev-parse','FETCH_HEAD']) === snapshot.commit,'REMOTE_MISMATCH','Cloud send checkout differs from approved snapshot.');
    git(temp,['checkout','--quiet','--detach','FETCH_HEAD']); return temp;
  } catch (e) { rmSync(temp,{recursive:true,force:true}); throw e; }
}
