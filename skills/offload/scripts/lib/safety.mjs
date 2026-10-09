import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, realpathSync, mkdirSync, chmodSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

export class OffloadError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = 'OffloadError'; this.code = code; this.details = details; }
}
export const fail = (code, message, details) => { throw new OffloadError(code, message, details); };
export const requireThat = (condition, code, message, details) => { if (!condition) fail(code, message, details); };
export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
export const digest = value => createHash('sha256').update(Buffer.isBuffer(value) ? value : JSON.stringify(canonical(value))).digest('hex');
export const makeId = () => `ofl_${randomUUID()}`;
export const validId = id => /^ofl_[0-9a-f-]{36}$/.test(id || '');
export function relativePath(p, allowDot = false) {
  requireThat(typeof p === 'string' && p.length > 0 && !/[\x00-\x1f\x7f\\:]/.test(p) && !path.posix.isAbsolute(p) && !p.split('/').some(v => v === '..' || v.toLowerCase() === '.git' || v === ''), 'UNSAFE_PATH', 'Only safe repository-relative paths are accepted.');
  requireThat(allowDot || p !== '.', 'UNSAFE_PATH', 'A file path is required.');
  return p;
}
export const inside = (root, file) => file === root || file.startsWith(root + path.sep);
export function noSymlink(file) {
  let p = path.resolve(file);
  while (true) {
    if (existsSync(p) && !(process.platform === 'darwin' && ['/var','/tmp','/etc'].includes(p) && realpathSync(p) === '/private' + p)) requireThat(!lstatSync(p).isSymbolicLink(), 'UNSAFE_PATH', 'Symlinks are not allowed in runtime state or export paths.');
    const parent = path.dirname(p); if (parent === p) break; p = parent;
  }
}
export function privateDir(p) { noSymlink(p); mkdirSync(p, { recursive: true, mode: 0o700 }); if (process.platform !== 'win32') chmodSync(p, 0o700); return p; }
export function writePrivate(file, content) {
  privateDir(path.dirname(file)); noSymlink(file);
  const tmp = `${file}.${randomUUID()}.tmp`;
  writeFileSync(tmp, content, { mode: 0o600, flag: 'wx' }); renameSync(tmp, file);
}
export const saveJson = (file, value) => writePrivate(file, JSON.stringify(value, null, 2) + '\n');
export function readJson(file, maxBytes = 1024 * 1024) {
  noSymlink(file); const st = lstatSync(file);
  requireThat(st.isFile() && st.size <= maxBytes, 'INPUT_SIZE', 'Input is not a regular file or exceeds the size limit.');
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { fail('INVALID_JSON', 'Input must contain valid JSON.'); }
}
export function stateRoot(env = process.env, platform = process.platform) {
  if (env.OFFLOAD_HOME) return path.resolve(env.OFFLOAD_HOME);
  if (platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'Offload');
  if (platform === 'win32') return path.join(env.LOCALAPPDATA || os.homedir(), 'Offload');
  return path.join(env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'), 'offload');
}
export function repository(url) {
  const match = /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(url || '');
  requireThat(match && !['.', '..'].includes(match[1]) && !['.', '..'].includes(match[2]), 'REPOSITORY_UNSUPPORTED', 'Only an uncredentialed github.com repository URL is supported.');
  return `${match[1]}/${match[2]}`.toLowerCase();
}
export function slug(value) { requireThat(typeof value === 'string' && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value), 'BAD_CONFIG', 'Expected owner/repository.'); return repository(`https://github.com/${value}`); }
export function officialUrl(url, provider) {
  if (url === undefined || url === null) return null;
  let u; try { u = new URL(url); } catch { fail('INVALID_RECEIPT', 'Receipt URL is invalid.'); }
  const allowed = { codex: ['chatgpt.com'], claude: ['claude.ai'], cursor: ['cursor.com'], devin: ['app.devin.ai'] };
  requireThat(u.protocol === 'https:' && !u.username && !u.password && !u.port && allowed[provider]?.includes(u.hostname) && !u.search, 'INVALID_RECEIPT', 'Receipt URL must be a credential-free official task URL.');
  return u.href;
}
const secrets = [
  /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/,
  /\b(?:sk-(?:proj-|ant-api\d+-)?|gh[pousr]_|github_pat_)[A-Za-z0-9_-]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\beyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{12,}\b/,
  /(?:https?|postgres(?:ql)?|mysql):\/\/[^\s/@:]+:[^\s/@]+@/,
  /(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*[=:]\s*["']?(?!\$|<|YOUR_|example|placeholder|process\.env|os\.environ)[A-Za-z0-9_+\/-]{20,}/i,
];
export function scanSecrets(value, location = 'input') {
  const text = Buffer.isBuffer(value) ? value.toString('utf8') : typeof value === 'string' ? value : JSON.stringify(value);
  requireThat(!secrets.some(re => re.test(text)), 'SECRET_DETECTED', 'Possible secret detected; no value is logged.', { location });
}
export function secretFile(p) {
  p = p.toLowerCase();
  return /(?:^|\/)(?:\.env(?:\..*)?|\.npmrc|\.pypirc|\.netrc|credentials(?:\.json)?|auth\.json|id_rsa|id_ed25519|\.credentials\.json)$/.test(p) && !/(?:^|\/)\.env\.(?:example|sample|template)$/.test(p) || /(?:^|\/)(?:\.ssh|\.aws|\.gnupg|browser-profile)(?:\/|$)/.test(p) || /\.(?:pem|p12|pfx|key)$/.test(p);
}
export function redact(value) {
  let s = String(value); for (const re of secrets) s = s.replace(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'), '[REDACTED]');
  return s.replace(/(Authorization\s*[:=]\s*)(?:Bearer|Basic)\s+\S+/gi, '$1[REDACTED]');
}
export function executable(name, excludedRoot = null) {
  const candidates = path.isAbsolute(name) ? [name] : (process.env.PATH || '').split(path.delimiter).filter(Boolean).flatMap(p => [path.join(p, name), ...(process.platform === 'win32' ? [path.join(p, name + '.exe')] : [])]);
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    const real = realpathSync(p); if (excludedRoot && inside(path.resolve(excludedRoot), real)) continue;
    if (lstatSync(real).isFile() && (process.platform === 'win32' || (lstatSync(real).mode & 0o111))) return real;
  }
  fail('NEEDS_SETUP', `Trusted executable not found: ${path.basename(name)}`);
}
export function run(binary, args, opts = {}) {
  requireThat(path.isAbsolute(binary), 'UNSAFE_EXECUTABLE', 'An absolute executable path is required.');
  const out = spawnSync(binary, args, { cwd: opts.cwd, env: opts.env || process.env, input: opts.input, encoding: opts.encoding === null ? null : 'utf8', timeout: opts.timeout || 120_000, maxBuffer: 32 * 1024 * 1024, shell: false, windowsHide: true });
  if (out.error || out.status !== 0) fail(out.error?.code === 'ETIMEDOUT' ? 'PROCESS_TIMEOUT' : 'PROCESS_FAILED', `${path.basename(binary)} failed; credentials and raw output are not logged.`, { status: out.status });
  return opts.encoding === null ? out.stdout : out.stdout.trim();
}
