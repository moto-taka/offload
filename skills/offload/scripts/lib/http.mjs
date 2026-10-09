import { requireThat, OffloadError, fail } from './safety.mjs';

const origins = { cursor: 'https://api.cursor.com', devin: 'https://api.devin.ai' };
export class CloudHTTP {
  constructor(provider, binding, { fetchFn = globalThis.fetch, env = process.env } = {}) {
    requireThat(origins[provider], 'INVALID_TARGET', 'No HTTP adapter for this provider.');
    const token = env[binding.credentialEnv];
    requireThat(typeof token === 'string' && token.length > 0 && !/[\r\n]/.test(token), 'NEEDS_AUTH', `Set the configured credential variable ${binding.credentialEnv || '(missing)'}.`);
    this.origin = origins[provider]; this.fetchFn = fetchFn; this.token = token;
  }
  async request(method, endpoint, body) {
    requireThat(/^\/v(?:1|3|3beta1)\//.test(endpoint) && !endpoint.includes('..') && !endpoint.includes('\\') && !/[\x00-\x20]/.test(endpoint), 'UNSAFE_ENDPOINT', 'Only fixed, provider-owned API paths are allowed.');
    let response;
    try {
      response = await this.fetchFn(this.origin + endpoint, { method, redirect: 'error', signal: AbortSignal.timeout(30_000), headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    } catch { fail(method === 'GET' ? 'NETWORK_ERROR' : 'SUBMISSION_UNKNOWN', 'Network response unavailable; do not blindly repeat a write.'); }
    if (!response.ok) {
      const e = new OffloadError(response.status === 401 ? 'NEEDS_AUTH' : response.status === 403 ? 'PERMISSION_DENIED' : response.status === 404 ? 'REMOTE_NOT_FOUND' : response.status === 409 ? 'REMOTE_CONFLICT' : response.status === 429 ? 'RATE_LIMITED' : 'REMOTE_ERROR', 'Provider rejected or failed the request; raw response is not logged.', { status: response.status });
      e.definitelyNotAccepted = response.status >= 400 && response.status < 500 && ![408,409,425,429].includes(response.status);
      throw e;
    }
    if (response.status === 204) return {};
    let text = '', bytes = 0;
    try {
      const reader = response.body.getReader(), decoder = new TextDecoder();
      while (true) { const { done, value } = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > 2_000_000) { await reader.cancel(); fail('REMOTE_SCHEMA_CHANGED', 'Provider response exceeds the limit.'); } text += decoder.decode(value, { stream: true }); }
      text += decoder.decode(); return JSON.parse(text);
    } catch (e) { if (e.code) throw e; fail('REMOTE_SCHEMA_CHANGED', 'Expected a bounded JSON response.'); }
  }
  async pages(endpoint, { items = 'items', cursor = 'nextCursor', parameter = 'cursor' } = {}) {
    const results = [], seen = new Set(); let next;
    for (let i = 0; i < 100; i++) {
      const suffix = next ? `${endpoint.includes('?') ? '&' : '?'}${parameter}=${encodeURIComponent(next)}` : '';
      const page = await this.request('GET', endpoint + suffix);
      requireThat(Array.isArray(page[items]), 'REMOTE_SCHEMA_CHANGED', 'Expected a paginated collection.'); results.push(...page[items]);
      next = page[cursor]; if (next === undefined || next === null || next === '') return results;
      requireThat(typeof next === 'string' && !seen.has(next), 'INCOMPLETE_DISCOVERY', 'Repeated/invalid pagination cursor; absence cannot be inferred.'); seen.add(next);
    }
    fail('INCOMPLETE_DISCOVERY', 'Discovery page limit reached; no new resource will be created.');
  }
}
export function remoteId(value) {
  requireThat(typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value), 'REMOTE_SCHEMA_CHANGED', 'Invalid or missing remote identifier.'); return value;
}
