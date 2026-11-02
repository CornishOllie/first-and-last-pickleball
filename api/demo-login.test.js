import test from 'node:test';
import assert from 'node:assert/strict';
import { makeHandler, _resetForTests } from './demo-login.js';

const ENV = { DEMO_MODE: 'on', SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-key-secret' };
const run = async (handler, { method = 'POST', body, ip = '1.1.1.1' } = {}) => {
  const out = { headers: {} };
  const res = { setHeader: (k, v) => (out.headers[k] = v), status(s) { out.status = s; return this; }, send(b) { out.body = JSON.parse(b); } };
  await handler({ method, body, headers: { 'x-forwarded-for': ip } }, res);
  return out;
};
function fake({ status = 200, realRows = [] } = {}) {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({ url: String(url), body: init.body ? JSON.parse(init.body) : null });
    if (String(url).includes('/rest/v1/play_members?')) return { ok: true, status: 200, json: async () => realRows };
    if (String(url).endsWith('/auth/v1/admin/generate_link')) {
      return { ok: status < 300, status, json: async () => ({ action_link: 'https://x.supabase.co/auth/v1/verify?token=SECRETLINK', email_otp: '123456', hashed_token: 'hashed-abc', verification_type: 'magiclink' }) };
    }
    throw new Error('unexpected ' + url);
  };
  return { f, calls };
}

test('off by default: no DEMO_MODE means 404 and no call to Supabase', async () => {
  _resetForTests();
  for (const env of [{ SUPABASE_URL: ENV.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: ENV.SUPABASE_SERVICE_ROLE_KEY }, { ...ENV, DEMO_MODE: 'off' }, { ...ENV, DEMO_MODE: '' }, { ...ENV, DEMO_MODE: 'ON' }]) {
    const { f, calls } = fake();
    const out = await run(makeHandler({ env, fetchFn: f }), { body: { who: 'sam' } });
    assert.equal(out.status, 404, JSON.stringify(env.DEMO_MODE));
    assert.equal(calls.length, 0);
  }
});

test('DEMO_MODE on but Supabase settings missing is still 404', async () => {
  _resetForTests();
  for (const env of [{ DEMO_MODE: 'on' }, { DEMO_MODE: 'on', SUPABASE_URL: ENV.SUPABASE_URL }, { DEMO_MODE: 'on', SUPABASE_SERVICE_ROLE_KEY: 'k' }]) {
    assert.equal((await run(makeHandler({ env, fetchFn: fake().f }), { body: { who: 'sam' } })).status, 404);
  }
});

test('each listed person gets a token for their own demo.invalid account, and only token_hash and email come back', async () => {
  const expected = { host: 'host@demo.invalid', sam: 'sam@demo.invalid', kit: 'kit@demo.invalid', jo: 'jo@demo.invalid' };
  for (const [who, email] of Object.entries(expected)) {
    _resetForTests();
    const { f, calls } = fake();
    const out = await run(makeHandler({ env: ENV, fetchFn: f }), { body: { who } });
    assert.equal(out.status, 200);
    assert.deepEqual(out.body, { email, token_hash: 'hashed-abc' });
    const gen = calls.filter((c) => c.url.endsWith('/auth/v1/admin/generate_link'));
    assert.equal(gen.length, 1);
    assert.deepEqual(gen[0].body, { type: 'magiclink', email });
    assert.equal(out.headers['Cache-Control'], 'no-store');
  }
});

test('unknown who is refused and never reaches Supabase', async () => {
  _resetForTests();
  const { f, calls } = fake();
  const h = makeHandler({ env: ENV, fetchFn: f });
  for (const who of ['', 'admin', 'SAM', ' sam', 'sam ', 'someone@gmail.com', 'sam@demo.invalid', '__proto__', 'constructor', 'toString', 5, null, ['sam'], { a: 1 }]) {
    assert.equal((await run(h, { body: { who } })).status, 400, JSON.stringify(who));
  }
  for (const body of [undefined, {}, 'not json', '{"who":"nobody"}']) assert.equal((await run(h, { body })).status, 400, JSON.stringify(body));
  assert.equal(calls.length, 0);
});

test('an email sent by the client is never used', async () => {
  _resetForTests();
  const { f, calls } = fake();
  const h = makeHandler({ env: ENV, fetchFn: f });
  const a = await run(h, { body: { who: 'sam', email: 'victim@gmail.com' } });
  assert.equal(a.status, 200);
  assert.equal(a.body.email, 'sam@demo.invalid');
  assert.equal((await run(h, { body: { email: 'victim@gmail.com' } })).status, 400);
  assert.equal((await run(h, { body: { who: 'victim@gmail.com' } })).status, 400);
  const gen = calls.filter((c) => c.url.endsWith('/auth/v1/admin/generate_link'));
  assert.ok(gen.length > 0 && gen.every((c) => c.body.email.endsWith('@demo.invalid')));
});

test('the action link, the one-time code and the service key never appear in a response', async () => {
  _resetForTests();
  const out = await run(makeHandler({ env: ENV, fetchFn: fake().f }), { body: { who: 'host' } });
  const text = JSON.stringify(out);
  assert.deepEqual(Object.keys(out.body).sort(), ['email', 'token_hash']);
  for (const bad of ['action_link', 'SECRETLINK', 'verify?token', '123456', 'service-key-secret']) assert.ok(!text.includes(bad), bad);
});

test('Supabase failures are reported, not hidden', async () => {
  _resetForTests();
  assert.equal((await run(makeHandler({ env: ENV, fetchFn: fake({ status: 500 }).f }), { body: { who: 'sam' } })).status, 502);
  const noToken = async (url) => ({ ok: true, status: 200, json: async () => (String(url).includes('/rest/v1/') ? [] : { action_link: 'x' }) });
  const checkDown = async () => ({ ok: false, status: 500, json: async () => ({}) });
  assert.equal((await run(makeHandler({ env: ENV, fetchFn: checkDown }), { body: { who: 'sam' } })).status, 502);
  assert.equal((await run(makeHandler({ env: ENV, fetchFn: noToken }), { body: { who: 'sam' } })).status, 502);
  const boom = async () => { throw new Error('down'); };
  assert.equal((await run(makeHandler({ env: ENV, fetchFn: boom }), { body: { who: 'sam' } })).status, 502);
});

test('wrong method', async () => {
  _resetForTests();
  assert.equal((await run(makeHandler({ env: ENV, fetchFn: fake().f }), { method: 'GET' })).status, 405);
});

test('too many tries from one place are slowed down, other places are not', async () => {
  _resetForTests();
  const h = makeHandler({ env: ENV, fetchFn: fake().f, now: () => 1000 });
  for (let i = 0; i < 20; i++) assert.equal((await run(h, { body: { who: 'sam' }, ip: '7.7.7.7' })).status, 200);
  assert.equal((await run(h, { body: { who: 'sam' }, ip: '7.7.7.7' })).status, 429);
  assert.equal((await run(h, { body: { who: 'sam' }, ip: '8.8.8.8' })).status, 200);
});

test('the limit lifts after the window', async () => {
  _resetForTests();
  let t = 1000;
  const h = makeHandler({ env: ENV, fetchFn: fake().f, now: () => t });
  for (let i = 0; i < 20; i++) await run(h, { body: { who: 'sam' }, ip: '9.9.9.9' });
  assert.equal((await run(h, { body: { who: 'sam' }, ip: '9.9.9.9' })).status, 429);
  t += 10 * 60 * 1000 + 1;
  assert.equal((await run(h, { body: { who: 'sam' }, ip: '9.9.9.9' })).status, 200);
});

test('switches itself off if any real (not demo.invalid) email is in the database', async () => {
  _resetForTests();
  const { f, calls } = fake({ realRows: [{ id: 'm1' }] });
  const out = await run(makeHandler({ env: ENV, fetchFn: f }), { body: { who: 'host' } });
  assert.equal(out.status, 404);
  assert.ok(!calls.some((c) => c.url.endsWith('/auth/v1/admin/generate_link')), 'must not make a sign-in token');
  const q = calls.find((c) => c.url.includes('/rest/v1/play_members?'));
  assert.ok(q && q.url.includes('email=not.like.*%40demo.invalid') && q.url.includes('email=neq.'), q?.url);
});
