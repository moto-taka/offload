import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { root, repoFixture, sample } from './helpers.mjs';
import { Core } from '../skills/offload/scripts/lib/core.mjs';
import { newBinding, saveConfig } from '../skills/offload/scripts/lib/config.mjs';
import { codexOnboarding, renderCodexOnboarding, CODEX_SETTINGS_URL, CODEX_SETUP_SKILL } from '../skills/offload/scripts/lib/codex-onboarding.mjs';

async function fixture() {
  const f = repoFixture();
  const c = new Core(path.join(f.base, 'state'), { fetchFn: () => assert.fail('Setup must execute in the host, not through a private API') });
  const b = newBinding('codex', 'example/fixture');
  Object.assign(b, { enabled: true, accountLabel: 'fixture', allowEnvironmentCreate: true, allowPromptGitGate: true });
  saveConfig(c.store.root, { version: 1, defaults: {}, bindings: [b] });
  const job = await c.prepare({ plan: sample(), repo: f.repo, target: 'codex' });
  c.approve(job.id, c.review(job.id).approvalHash);
  return { ...f, c, job, close() { c.close(); f.cleanup(); } };
}
function authProof(intent, extra = {}) {
  return { nonce: intent.nonce, status: 'NEEDS_AUTH', url: CODEX_SETTINGS_URL, evidenceRefs: ['fixture:login-screen'], ...extra };
}
function readyProof(f, intent) {
  return { nonce: intent.nonce, account: 'fixture', repository: 'example/fixture', flavor: 'codex_new_ui', recipeHash: f.job.recipeHash, environmentId: 'setup-environment', url: CODEX_SETTINGS_URL, personal: true, published: true, validation: 'passed', evidenceRefs: ['fixture:setup-result'] };
}

test('Codex onboarding targets the fixed settings URL and exact requested Setup skill', () => {
  const r = codexOnboarding('moto-taka/offload');
  assert.equal(r.url, 'https://chatgpt.com/settings/codex-cloud');
  assert.equal(r.skill, 'Cloud Environment Onboarding: Setup');
  assert.equal(r.prompt, 'Cloud Environment Onboarding: Setup を使って、https://github.com/moto-taka/offload のクラウド環境をセットアップしてください。未認証の場合は、ログインを求めてください。');
  assert.equal(renderCodexOnboarding('moto-taka/offload'), `${r.url} から、次の指示を実行してください。\n\n${r.prompt}\n`);
});

test('Codex onboarding does not accept an arbitrary URL or injected repository text', () => {
  for (const repo of ['https://evil.invalid/a/b', 'owner/repo\nPublish', 'owner/repo/extra']) {
    assert.throws(() => codexOnboarding(repo));
  }
});

test('headless setup returns the host instruction, not a made-up provisioned environment', () => {
  const f = repoFixture();
  try {
    const r = spawnSync(process.execPath, [path.join(root, 'skills/offload/scripts/offload.mjs'), 'setup', 'codex', '--repo', f.repo], { encoding: 'utf8', env: { ...process.env, OFFLOAD_HOME: path.join(f.base, 'state') } });
    assert.equal(r.status, 0, r.stderr);
    const value = JSON.parse(r.stdout);
    assert.deepEqual(value.onboarding, codexOnboarding('example/fixture'));
    assert.equal(value.enabled, false);
    assert.equal(value.binding.environmentId, undefined);
    assert.match(value.note, /No cloud environment or task was created/);
  } finally { f.cleanup(); }
});

test('environment intent supplies only the Setup instruction and journals before host execution', async () => {
  const f = await fixture();
  try {
    const output = await f.c.submit(f.job.id);
    assert.equal(output.state, 'NEEDS_UI_DRIVER');
    assert.deepEqual(output.error.details.onboarding, codexOnboarding('example/fixture'));
    const intent = await f.c.uiBegin(f.job.id, 'environment');
    assert.deepEqual(intent.onboarding, codexOnboarding('example/fixture'));
    assert.equal(f.c.store.operation(intent.operationId).state, 'STARTED');
    const prompt = fs.readFileSync(intent.artifactPath, 'utf8');
    assert.equal(prompt, renderCodexOnboarding('example/fixture'));
    assert.doesNotMatch(prompt, /Publish|npm install|source_commit|install_commands/);
    assert.equal(f.c.store.get(f.job.id).receipt, undefined);
  } finally { f.close(); }
});

test('pre-send login requests authentication and reuses the same Plan/job after login', async () => {
  const f = await fixture();
  try {
    const before = fs.readFileSync(f.c.store.file(f.job.id, 'plan.json'), 'utf8');
    const intent = await f.c.uiBegin(f.job.id, 'environment');
    const paused = await f.c.uiRecord(f.job.id, 'environment', authProof(intent, { setupStarted: false }));
    assert.equal(paused.state, 'NEEDS_AUTH');
    assert.equal(paused.error.details.loginUrl, CODEX_SETTINGS_URL);
    assert.equal(paused.receipt, undefined);
    assert.equal(f.c.store.operation(intent.operationId).state, 'REJECTED');
    assert.equal((await f.c.submit(f.job.id)).state, 'NEEDS_AUTH');
    const resumed = await f.c.uiBegin(f.job.id, 'environment');
    assert.equal(resumed.jobId, intent.jobId);
    assert.notEqual(resumed.nonce, intent.nonce);
    assert.equal(resumed.reconcileOnly, false);
    assert.equal(f.c.store.get(f.job.id).error, undefined);
    assert.equal(fs.readFileSync(f.c.store.file(f.job.id, 'plan.json'), 'utf8'), before);
    await assert.rejects(() => f.c.uiRecord(f.job.id, 'environment', authProof(intent)), { code: 'OBSERVATION_MISMATCH' });
    const ready = await f.c.uiRecord(f.job.id, 'environment', readyProof(f, resumed));
    assert.equal(ready.state, 'READY_TO_SUBMIT');
    assert.equal(ready.environment.id, 'setup-environment');
    assert.equal(ready.receipt, undefined);
    assert.equal((await f.c.uiBegin(f.job.id, 'environment')).done, true);
  } finally { f.close(); }
});

for (const started of [true, undefined]) test(`login after started/unknown Setup (${started}) never starts another Setup`, async () => {
  const f = await fixture();
  try {
    const intent = await f.c.uiBegin(f.job.id, 'environment');
    await f.c.uiRecord(f.job.id, 'environment', authProof(intent, { setupStarted: started }));
    const resumed = await f.c.uiBegin(f.job.id, 'environment');
    assert.equal(resumed.nonce, intent.nonce);
    assert.equal(resumed.reconcileOnly, true);
    assert.equal(resumed.artifactPath, intent.artifactPath);
    assert.equal(f.c.store.operation(intent.operationId).state, 'STARTED');
    assert.equal((await f.c.uiRecord(f.job.id, 'environment', readyProof(f, intent))).state, 'READY_TO_SUBMIT');
  } finally { f.close(); }
});

test('authentication does not replace Setup readiness or bypass account checks', async () => {
  const f = await fixture();
  try {
    const intent = await f.c.uiBegin(f.job.id, 'environment');
    await assert.rejects(() => f.c.uiRecord(f.job.id, 'environment', { ...readyProof(f, intent), account: 'other' }), { code: 'OBSERVATION_MISMATCH' });
    await assert.rejects(() => f.c.uiRecord(f.job.id, 'environment', { ...readyProof(f, intent), published: false }), { code: 'ENVIRONMENT_NOT_READY' });
    await assert.rejects(() => f.c.uiBegin(f.job.id, 'task'), { code: 'ENVIRONMENT_NOT_READY' });
    await assert.rejects(() => f.c.uiRecord(f.job.id, 'environment', authProof(intent, { evidenceRefs: [] })), { code: 'MISSING_EVIDENCE' });
    await assert.rejects(() => f.c.uiRecord(f.job.id, 'environment', authProof(intent, { url: 'https://evil.invalid/login' })), { code: 'INVALID_RECEIPT' });
    await assert.rejects(() => f.c.uiRecord(f.job.id, 'environment', authProof(intent, { published: true })), { code: 'OBSERVATION_MISMATCH' });
    await assert.rejects(() => f.c.uiRecord(f.job.id, 'environment', authProof(intent, { setupStarted: 'false' })), { code: 'OBSERVATION_MISMATCH' });
  } finally { f.close(); }
});

test('a completed Setup cannot be downgraded to a retryable login failure', async () => {
  const f = await fixture();
  try {
    const intent = await f.c.uiBegin(f.job.id, 'environment');
    await f.c.uiRecord(f.job.id, 'environment', readyProof(f, intent));
    await assert.rejects(() => f.c.uiRecord(f.job.id, 'environment', authProof(intent, { setupStarted: false })), { code: 'OPERATION_CHANGED' });
    assert.equal(f.c.store.operation(intent.operationId).state, 'DONE');
  } finally { f.close(); }
});

test('skill and environment guide delegate Setup and explain login without manual ID entry', () => {
  const skill = fs.readFileSync(path.join(root, 'skills/offload/SKILL.md'), 'utf8');
  const guide = fs.readFileSync(path.join(root, 'skills/offload/references/codex-ui.md'), 'utf8');
  const cli = fs.readFileSync(path.join(root, 'skills/offload/scripts/offload.mjs'), 'utf8');
  for (const text of [skill, guide]) {
    assert.ok(text.includes(CODEX_SETUP_SKILL));
    assert.ok(text.includes(CODEX_SETTINGS_URL));
    assert.match(text, /NEEDS_AUTH/);
  }
  assert.doesNotMatch(cli, /rl\.question\('Existing new Cloud environment ID/);
});
