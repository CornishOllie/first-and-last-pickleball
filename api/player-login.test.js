import test from 'node:test';
import assert from 'node:assert/strict';
import { makeHandler, _resetForTests } from './player-login.js';

const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-key-secret' };
const run = async (handler, { method = 'POST', body, ip = '1.1.1.1' } = {}) => {
  const out = { headers: {} };
  const res = { setHeader: (k, v) => (out.headers[k] = v), status(s) { out.status = s; return this; }, send(b) { out.body = JSON.parse(b); } };
  await handler({ method, body, headers: { 'x-forwarded-for': ip } }, res);
  return out;
};
function fake({ known = true, adminStatus = 200 } = {}) {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({ url: String(url), body: init.body ? JSON.parse(init.body) : null, headers: init.headers });
    if (String(url).endsWith('/rpc/play_email_known')) return { ok: true, status: 200, json: async () => known };
    if (String(url).endsWith('/auth/v1/admin/users')) return { ok: adminStatus < 300, status: adminStatus, json: async () => ({}) };
    throw new Error('unexpected ' + url);
  };
  return { f, calls };
}

test('known email: account is created (confirmed), answer is a plain ok', async () => {
  _resetForTests();
  const { f, calls } = fake();
  const out = await run(makeHandler({ env: ENV, fetchFn: f }), { body: { email: '  Ann@Example.com ' } });
  assert.equal(out.status, 200);
  assert.deepEqual(out.body, { ok: true });
  assert.equal(out.headers['Cache-Control'], 'no-store');
  assert.deepEqual(calls[0].body, { p_email: 'ann@example.com' });
  assert.deepEqual(calls[1].body, { email: 'ann@example.com', email_confirm: true });
});

test('unknown email: no account is created, and the answer looks exactly the same', async () => {
  _resetForTests();
  const { f, calls } = fake({ known: false });
  const out = await run(makeHandler({ env: ENV, fetchFn: f }), { body: { email: 'nobody@example.com' } });
  assert.equal(out.status, 200);
  assert.deepEqual(out.body, { ok: true });
  assert.equal(calls.length, 1, 'only the lookup, never the admin call');
});

test('account that already exists is fine', async () => {
  _resetForTests();
  const out = await run(makeHandler({ env: ENV, fetchFn: fake({ adminStatus: 422 }).f }), { body: { email: 'ann@example.com' } });
  assert.equal(out.status, 200);
});

test('a real failure creating the account is reported, not hidden', async () => {
  _resetForTests();
  const out = await run(makeHandler({ env: ENV, fetchFn: fake({ adminStatus: 500 }).f }), { body: { email: 'ann@example.com' } });
  assert.equal(out.status, 502);
});

test('bad input, wrong method, missing settings', async () => {
  _resetForTests();
  const h = makeHandler({ env: ENV, fetchFn: fake().f });
  for (const body of [undefined, {}, { email: 5 }, { email: 'not-an-email' }, { email: 'a@b' }, { email: 'x'.repeat(250) + '@e.com' }]) assert.equal((await run(h, { body })).status, 400, JSON.stringify(body));
  assert.equal((await run(h, { method: 'GET', body: { email: 'a@b.co' } })).status, 405);
  assert.equal((await run(makeHandler({ env: {}, fetchFn: fake().f }), { body: { email: 'a@b.co' } })).status, 503);
});

test('the service key never appears in a response', async () => {
  _resetForTests();
  const out = await run(makeHandler({ env: ENV, fetchFn: fake().f }), { body: { email: 'ann@example.com' } });
  assert.ok(!JSON.stringify(out).includes('service-key-secret'));
});

test('too many tries from one place are slowed down', async () => {
  _resetForTests();
  const h = makeHandler({ env: ENV, fetchFn: fake().f, now: () => 1000 });
  for (let i = 0; i < 8; i++) assert.equal((await run(h, { body: { email: 'ann@example.com' }, ip: '7.7.7.7' })).status, 200);
  assert.equal((await run(h, { body: { email: 'ann@example.com' }, ip: '7.7.7.7' })).status, 429);
  assert.equal((await run(h, { body: { email: 'ann@example.com' }, ip: '8.8.8.8' })).status, 200);
});
