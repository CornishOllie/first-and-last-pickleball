import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeHandler } from './keepalive.js';

const res = () => {
  const r = { code: 0, body: null, headers: {} };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
};

test('not set up: answers 503 and makes no request', async () => {
  let called = false;
  const r = res();
  await makeHandler({ env: {}, fetchFn: async () => { called = true; } })({}, r);
  assert.equal(r.code, 503);
  assert.equal(called, false);
});

test('reads one club row with the public key', async () => {
  let url, headers;
  const r = res();
  await makeHandler({ env: { PUBLIC_SUPABASE_URL: 'https://x.supabase.co', PUBLIC_SUPABASE_ANON_KEY: 'anon' }, fetchFn: async (u, o) => { url = u; headers = o.headers; return { ok: true }; } })({}, r);
  assert.equal(r.code, 200);
  assert.equal(url, 'https://x.supabase.co/rest/v1/clubs?select=id&limit=1');
  assert.equal(headers.apikey, 'anon');
  assert.equal(r.headers['Cache-Control'], 'no-store');
});

test('database down: answers 502', async () => {
  const r = res();
  await makeHandler({ env: { PUBLIC_SUPABASE_URL: 'u', PUBLIC_SUPABASE_ANON_KEY: 'k' }, fetchFn: async () => ({ ok: false }) })({}, r);
  assert.equal(r.code, 502);
  const r2 = res();
  await makeHandler({ env: { PUBLIC_SUPABASE_URL: 'u', PUBLIC_SUPABASE_ANON_KEY: 'k' }, fetchFn: async () => { throw new Error('x'); } })({}, r2);
  assert.equal(r2.code, 502);
});
