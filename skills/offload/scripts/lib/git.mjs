import { readFileSync, readlinkSync, lstatSync, realpathSync, mkdtempSync, rmSync, openSync, closeSync, fstatSync, constants } from 'node:fs';
import path from 'node:path';
import { executable, run, requireThat, repository, digest, relativePath, scanSecrets, secretFile, privateDir, inside, fail } from './safety.mjs';

export function git(cwd, args, options = {}) {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' };
  for (const k of Object.keys(env)) if (/^GIT_(?:DIR|WORK_TREE|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|CONFIG|SSH_COMMAND)/.test(k)) delete env[k];
  Object.assign(env, options.env || {});
  return run(options.binary || executable('git', cwd), ['-c','core.fsmonitor=false','-c','core.hooksPath=' + (process.platform === 'win32' ? 'NUL' : '/dev/null'), ...args], { ...options, env, cwd });
}
// Read Git identity without scanning/exporting the worktree. Setup must not depend on exportability.
export function repositoryInfo(cwd) {
  const root = realpathSync(git(cwd, ['rev-parse', '--show-toplevel']));
  const head = git(root, ['rev-parse', 'HEAD']);
  requireThat(/^[a-f0-9]{40,64}$/.test(head), 'GIT_EMPTY', 'Commit the repository before offloading.');
  const remote = git(root, ['remote', 'get-url', 'origin']);
  const repo = repository(remote);
  requireThat(repository(git(root, ['remote', 'get-url', '--push', 'origin'])) === repo,
    'REMOTE_MISMATCH', 'Origin fetch/push repositories differ.');
  let branch = null;
  try { branch = git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD']); } catch {}
  return { root, head, branch, repository: repo, remote };
}

const MAX_FILE_BYTES = 100 * 1024 * 1024;
const MAX_FILES = 100_000;

// Never follow a symlink in an ancestor of an exported file.
function filePath(root, name) {
  relativePath(name);
  const parts = name.split('/');
  let parent = root;
  for (const part of parts.slice(0, -1)) {
    parent = path.join(parent, part);
    const st = lstatSync(parent);
    requireThat(st.isDirectory() && !st.isSymbolicLink(), 'UNSAFE_PATH',
      'An export ancestor must be a real directory.', { location: name });
  }
  return path.join(root, name);
}

function sameFile(a, b) {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size &&
    a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs && a.mode === b.mode;
}

function fileContent(root, name) {
  const full = filePath(root, name), before = lstatSync(full);
  requireThat(before.isFile() || before.isSymbolicLink(), 'UNSUPPORTED_FILE',
    'Only regular files and repository-internal symlinks are supported.', { location: name });
  requireThat(before.size <= MAX_FILE_BYTES, 'EXPORT_TOO_LARGE',
    'A single file exceeds the 100 MiB safety limit; no aggregate 20 MiB limit applies.', { location: name });
  let data, mode;
  if (before.isSymbolicLink()) {
    // Git mode 120000 stores the link text, NOT the contents of its target.
    data = Buffer.from(readlinkSync(full), 'utf8');
    mode = '120000';
  } else {
    const fd = openSync(full, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    try {
      requireThat(sameFile(before, fstatSync(fd)), 'SOURCE_CHANGED', 'File replaced during capture.', { location: name });
      data = readFileSync(fd);
      requireThat(sameFile(before, fstatSync(fd)), 'SOURCE_CHANGED', 'File changed during capture.', { location: name });
    } finally { closeSync(fd); }
    mode = (before.mode & 0o111) ? '100755' : '100644';
  }
  requireThat(sameFile(before, lstatSync(full)) && data.length === before.size,
    'SOURCE_CHANGED', 'File changed during capture.', { location: name });
  return { data, mode };
}

// Resolve links in the proposed Git tree, never in an external filesystem.
// Covers directory links, chained links, loops, escape-after-expansion and absent targets.
export function validateLinks(files) {
  const entries = new Map(files.map(f => [f.path, f]));
  const directories = new Set(['']);
  for (const f of files) {
    const parts = f.path.split('/');
    for (let i = 1; i < parts.length; i++) directories.add(parts.slice(0, i).join('/'));
  }
  for (const link of files.filter(f => f.mode === '120000')) {
    let queue = link.path.split('/'), resolved = [], hops = 0;
    while (queue.length) {
      const part = queue.shift();
      if (part === '' || part === '.') continue;
      if (part === '..') {
        requireThat(resolved.length > 0, 'UNSAFE_SYMLINK', 'Symlink escapes the repository.', { location: link.path });
        resolved.pop(); continue;
      }
      const candidate = [...resolved, part].join('/');
      requireThat(!secretFile(candidate) && part.toLowerCase() !== '.git', 'UNSAFE_SYMLINK',
        'Symlink targets credentials or Git metadata.', { location: link.path });
      const entry = entries.get(candidate);
      if (entry?.mode === '120000') {
        const target = entry.linkTarget ?? Buffer.from(entry.data || '', 'base64').toString('utf8');
        requireThat(++hops <= 40 && target && !/^[\/]/.test(target) && !/[\\:\x00-\x1f\x7f]/.test(target),
          'UNSAFE_SYMLINK', 'Absolute, cyclic, or non-portable symlink.', { location: link.path });
        queue = [...target.split('/'), ...queue];
      } else {
        requireThat(entry || directories.has(candidate), 'UNRESOLVED_SYMLINK',
          'Symlink target is not present in the exported tree.', { location: link.path });
        requireThat(!queue.length || directories.has(candidate), 'UNSAFE_SYMLINK',
          'Symlink traverses a regular file.', { location: link.path });
        resolved.push(part);
      }
    }
    // A link to one of its own ancestor directories makes recursive tree consumers loop.
    const destination = resolved.join('/');
    requireThat(destination && !(link.path === destination || link.path.startsWith(destination + '/')),
      'UNSAFE_SYMLINK', 'Symlink creates a recursive directory loop.', { location: link.path });
  }
}

export function capture(cwd) {
  const identity = repositoryInfo(cwd), { root, head, branch, repository: repo } = identity;
  const entries = git(root, ['ls-files', '--stage', '-z']).split('\0').filter(Boolean);
  const tracked = new Set();
  for (const entry of entries) {
    const m = /^(\d+) ([a-f0-9]+) (\d)\t([\s\S]+)$/.exec(entry);
    requireThat(m && m[3] === '0', 'GIT_CONFLICT', 'Resolve Git conflicts before offloading.');
    requireThat(['100644', '100755', '120000'].includes(m[1]), 'SUBMODULE_UNSUPPORTED',
      'Git submodules require a separate export implementation.', { location: m[4] });
    tracked.add(m[4]);
  }
  const untracked = git(root, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean);
  const names = [...new Set([...tracked, ...untracked])].sort();
  requireThat(names.length <= MAX_FILES, 'EXPORT_TOO_LARGE', 'More than 100,000 files in the proposed snapshot.');
  const files = [], deleted = [], lower = new Set();
  let bytes = 0;
  for (const name of names) {
    relativePath(name);
    requireThat(!lower.has(name.toLowerCase()), 'CASE_COLLISION', 'Case-colliding filenames cannot be exported portably.');
    lower.add(name.toLowerCase());
    requireThat(!secretFile(name) && name !== '.gitmodules', 'SECRET_FILE',
      'Credential or unsupported repository metadata file cannot be exported.', { location: name });
    let content;
    try { content = fileContent(root, name); }
    catch (e) { if (e.code === 'ENOENT') { if (tracked.has(name)) deleted.push(name); continue; } throw e; }
    const { data, mode } = content;
    bytes += data.length;
    scanSecrets(data, name);
    if (name.endsWith('.gitattributes')) requireThat(!/filter\s*=\s*lfs/.test(data.toString()),
      'LFS_UNSUPPORTED', 'Git LFS exports require a dedicated implementation.');
    // Metadata only: large repos no longer become huge base64 JSON artifacts.
    files.push({ path: name, mode, hash: digest(data), bytes: data.length, untracked: !tracked.has(name),
      ...(mode === '120000' ? { linkTarget: data.toString('utf8') } : {}) });
  }
  validateLinks(files);
  const fingerprint = digest({ head, branch, repo, files, deleted });
  return { ...identity, fingerprint, files, deleted, totalBytes: bytes, formatVersion: 2 };
}

export function readCapturedFile(manifest, file) {
  let data;
  if (typeof file.data === 'string') data = Buffer.from(file.data, 'base64'); // old saved jobs
  else {
    const observed = fileContent(manifest.root, file.path);
    requireThat(observed.mode === file.mode, 'SOURCE_CHANGED', 'Captured file type changed.', { location: file.path });
    data = observed.data;
  }
  requireThat(data.length === file.bytes && digest(data) === file.hash,
    'SOURCE_CHANGED', 'Captured file changed; prepare a new job rather than rebinding the Plan.', { location: file.path });
  return data;
}
export function verifyCapture(saved) {
  const current = capture(saved.root);
  requireThat(current.fingerprint === saved.fingerprint, 'SOURCE_CHANGED', 'Repository changed after planning. Prepare a new job; the saved plan is not silently rebound.'); return current;
}
export function inspectRecipe(manifest) {
  const byPath = new Map(manifest.files.map(f => [f.path, f]));
  if (!byPath.has('package.json')) return { recipe: null, reason: 'Automatic recipe detection currently supports Node projects. Supply a reviewed v2.0 EnvironmentRecipe for other stacks.' };
  let pkg; try { pkg = JSON.parse(readCapturedFile(manifest, byPath.get('package.json')).toString('utf8')); } catch { return { recipe: null, reason: 'package.json is invalid.' }; }
  const matches = [['pnpm','pnpm-lock.yaml'],['npm','package-lock.json'],['yarn','yarn.lock'],['bun','bun.lock']].filter(([, f]) => byPath.has(f));
  if (matches.length !== 1) return { recipe: null, reason: 'Exactly one recognized lockfile is needed for automatic environment generation.' };
  const [manager, lock] = matches[0], source = ['package.json',lock];
  const runtimes = [];
  for (const f of ['.node-version','.nvmrc']) if (byPath.has(f)) { source.push(f); runtimes.push({ name: 'node', version_requirement: readCapturedFile(manifest, byPath.get(f)).toString().trim(), source_refs: [f] }); break; }
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
      const data = readCapturedFile(manifest, f);
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
