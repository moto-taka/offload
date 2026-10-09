import { DatabaseSync } from 'node:sqlite';
import { existsSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { privateDir, noSymlink, readJson, saveJson, requireThat, fail, digest, validId } from './safety.mjs';

export class Store {
  constructor(root) {
    this.root = privateDir(path.resolve(root));
    const file = path.join(this.root, 'jobs.sqlite'); noSymlink(file);
    this.db = new DatabaseSync(file);
    if (process.platform !== 'win32') chmodSync(file, 0o600);
    this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, request_key TEXT UNIQUE NOT NULL, data TEXT NOT NULL, updated TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS operations(id TEXT PRIMARY KEY, payload_hash TEXT NOT NULL, state TEXT NOT NULL, result TEXT, updated TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS environments(id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS approvals(id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS leases(id TEXT PRIMARY KEY, owner TEXT NOT NULL, pid INTEGER NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS observations(id INTEGER PRIMARY KEY, job_id TEXT NOT NULL, data TEXT NOT NULL);`);
  }
  close() { this.db.close(); }
  dir(id) { requireThat(validId(id), 'INVALID_JOB_ID', 'Invalid job ID.'); return privateDir(path.join(this.root, 'jobs', id)); }
  file(id, name) { requireThat(/^[a-z0-9.-]+$/.test(name), 'UNSAFE_PATH', 'Invalid artifact name.'); return path.join(this.dir(id), name); }
  artifact(id, name, value) { saveJson(this.file(id, name), value); }
  read(id, name) { return readJson(this.file(id, name), 32 * 1024 * 1024); }
  get(id) {
    requireThat(validId(id), 'INVALID_JOB_ID', 'Invalid job ID.');
    const row = this.db.prepare('SELECT data FROM jobs WHERE id=?').get(id);
    requireThat(row, 'JOB_NOT_FOUND', 'Job does not exist in this local state directory.'); return JSON.parse(row.data);
  }
  byRequest(key) { const row = this.db.prepare('SELECT data FROM jobs WHERE request_key=?').get(key); return row ? JSON.parse(row.data) : null; }
  list() { return this.db.prepare('SELECT data FROM jobs ORDER BY updated DESC LIMIT 100').all().map(r => JSON.parse(r.data)); }
  create(job) { this.db.prepare('INSERT INTO jobs VALUES(?,?,?,?)').run(job.id, job.requestKey, JSON.stringify(job), new Date().toISOString()); return job; }
  save(job) { this.db.prepare('UPDATE jobs SET data=?, updated=? WHERE id=?').run(JSON.stringify(job), new Date().toISOString(), job.id); return job; }
  approval(id) { const r = this.db.prepare('SELECT data FROM approvals WHERE id=?').get(id); return r && JSON.parse(r.data); }
  approve(id, data) { this.db.prepare('INSERT OR REPLACE INTO approvals VALUES(?,?)').run(id, JSON.stringify(data)); }
  env(id) { const r = this.db.prepare('SELECT data FROM environments WHERE id=?').get(id); return r && JSON.parse(r.data); }
  saveEnv(id, data) { this.db.prepare('INSERT OR REPLACE INTO environments VALUES(?,?)').run(id, JSON.stringify(data)); }
  observe(id, data) { this.db.prepare('INSERT INTO observations(job_id,data) VALUES(?,?)').run(id, JSON.stringify({ at: new Date().toISOString(), ...data })); }
  operation(id) { return this.db.prepare('SELECT * FROM operations WHERE id=?').get(id); }
  startOperation(id, payload) {
    const hash = digest(payload), old = this.operation(id);
    if (old) {
      requireThat(old.payload_hash === hash, 'OPERATION_CHANGED', 'Saved operation payload differs; do not retry with new input.');
      if (old.state === 'DONE') return { done: true, result: JSON.parse(old.result) };
      if (old.state !== 'REJECTED') fail('SUBMISSION_UNKNOWN', 'An earlier write may have succeeded. Reconcile it before retrying.', { operationId: id });
    }
    this.db.prepare('INSERT OR REPLACE INTO operations VALUES(?,?,?,NULL,?)').run(id, hash, 'STARTED', new Date().toISOString());
    return { done: false };
  }
  finishOperation(id, result) { this.db.prepare('UPDATE operations SET state=?,result=?,updated=? WHERE id=?').run('DONE', JSON.stringify(result), new Date().toISOString(), id); }
  rejectOperation(id) { this.db.prepare('UPDATE operations SET state=?,updated=? WHERE id=?').run('REJECTED', new Date().toISOString(), id); }
  async once(id, payload, fn) {
    const start = this.startOperation(id, payload); if (start.done) return start.result;
    try { const result = await fn(); this.finishOperation(id, result); return result; }
    catch (e) { if (e.definitelyNotAccepted) this.rejectOperation(id); throw e; }
  }
  async locked(key, fn) {
    const owner = randomUUID(), now = Date.now();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const old = this.db.prepare('SELECT * FROM leases WHERE id=?').get(key);
      if (old) {
        let alive = true; try { process.kill(old.pid, 0); } catch (e) { if (e.code === 'ESRCH') alive = false; }
        requireThat(!alive && old.expires < now, 'BUSY', 'Another operation holds this job or environment lock. Retry after it finishes.');
        this.db.prepare('DELETE FROM leases WHERE id=?').run(key);
      }
      this.db.prepare('INSERT INTO leases VALUES(?,?,?,?)').run(key, owner, process.pid, now + 30_000); this.db.exec('COMMIT');
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
    try { return await fn(); } finally { this.db.prepare('DELETE FROM leases WHERE id=? AND owner=?').run(key, owner); }
  }
}
