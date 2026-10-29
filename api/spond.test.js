import test from 'node:test';
import assert from 'node:assert/strict';
import { makeHandler, _resetForTests } from './spond-lists.js';
import { shapeEvents } from './_spond.js';

const members = [
  { id: 'M1', firstName: 'Ann', lastName: 'Smith' }, { id: 'M2', firstName: 'Bob', lastName: 'Jones' },
  { id: 'M3', firstName: 'Cat', lastName: 'Lee' }, { id: 'M4', firstName: 'Dan', lastName: 'Moss' }, { id: 'M5', firstName: 'Eve', lastName: 'Ray' },
];
const club = { id: 'G1', name: 'First & Last Pickleball Club', members };
const other = { id: 'G2', name: 'Some Other Club', members };
const events = [
  { id: 'E2', heading: 'Sunday', startTimestamp: '2026-11-01T09:00:00Z', recipients: { group: club }, responses: { acceptedIds: ['M1'], declinedIds: ['M2'], unansweredIds: ['M3'], waitinglistIds: [] } },
  { id: 'E1', heading: 'Wednesday Intermediate Plus', startTimestamp: '2026-10-28T19:00:00Z', recipients: { group: club }, responses: { acceptedIds: ['M1', 'M2', 'M5'], declinedIds: ['M3'], unansweredIds: ['M4'], waitinglistIds: ['M4'] } },
  { id: 'E3', heading: 'Other club night', startTimestamp: '2026-10-29T19:00:00Z', recipients: { group: other }, responses: { acceptedIds: ['M1'] } },
  { id: 'E4', heading: 'Cancelled', cancelled: true, startTimestamp: '2026-10-30T19:00:00Z', recipients: { group: club }, responses: { acceptedIds: ['M1'] } },
];

const ENV = { SPOND_EMAIL: 'tool@example.test', SPOND_PASSWORD: 'secret-pw', PLAY_LIST_CODE: 'letmein-4821' };
function fakeSpond(calls, { loginOk = true, eventsPayload = events, expire = false } = {}) {
  let issued = 0;
  return async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || 'GET', headers: init.headers, body: init.body });
    const ok = (body) => ({ ok: true, status: 200, json: async () => body });
    if (String(url).endsWith('auth2/login')) return loginOk ? ok({ accessToken: { token: `TOKEN${++issued}` } }) : { ok: false, status: 401, json: async () => ({}) };
    if (expire && init.headers?.authorization === 'Bearer TOKEN1') return { ok: false, status: 401, json: async () => ({}) };
    if (String(url).includes('/sponds/')) return ok(eventsPayload);
    if (String(url).includes('/groups/')) return ok([club]);
    throw new Error('unexpected ' + url);
  };
}
const run = async (handler, { method = 'GET', code, ip = '1.1.1.1' } = {}) => {
  const out = { headers: {} };
  const res = { setHeader: (k, v) => (out.headers[k] = v), status(s) { out.status = s; return this; }, send(b) { out.body = JSON.parse(b); } };
  await handler({ method, headers: { 'x-play-code': code, 'x-forwarded-for': ip } }, res);
  return out;
};
const fast = { sleep: async () => {} };

test('shapeEvents keeps only the club group, drops cancelled, passes on accepted and waiting only, in date order', () => {
  const out = shapeEvents(events, [], 'First & Last');
  assert.deepEqual(out.map((e) => e.id), ['E1', 'E2']);
  assert.deepEqual(out[0].accepted, ['Ann Smith', 'Bob Jones', 'Eve Ray']);
  assert.deepEqual(out[0].waiting, ['Dan Moss']);
  assert.ok(!JSON.stringify(out).includes('Cat Lee'), 'declined people are not passed on');
  assert.ok(!('declined' in out[0]) && !('unanswered' in out[0]));
});

test('shapeEvents falls back to the groups list when events carry no member names', () => {
  const bare = events.map((e) => ({ ...e, recipients: { group: { id: 'G1', name: 'First & Last Pickleball Club' } } }));
  const out = shapeEvents(bare, [club], 'First & Last');
  assert.deepEqual(out[0].accepted, ['Ann Smith', 'Bob Jones', 'Eve Ray']);
});

test('good code: signs in to Spond, returns the shaped lists, never cached by browsers', async () => {
  _resetForTests();
  const calls = [];
  const out = await run(makeHandler({ env: ENV, fetchFn: fakeSpond(calls), ...fast }), { code: 'letmein-4821' });
  assert.equal(out.status, 200);
  assert.equal(out.headers['Cache-Control'], 'no-store');
  assert.deepEqual(out.body.events.map((e) => e.heading), ['Wednesday Intermediate Plus', 'Sunday']);
  const login = calls.find((c) => c.url.endsWith('auth2/login'));
  assert.deepEqual(JSON.parse(login.body), { email: 'tool@example.test', password: 'secret-pw' });
  assert.ok(calls.some((c) => c.url.includes('/sponds/') && c.headers.authorization === 'Bearer TOKEN1'));
  assert.ok(!JSON.stringify(out.body).includes('secret-pw'), 'password never leaves the server');
});

test('wrong, missing or odd codes are refused and Spond is never contacted', async () => {
  for (const code of [undefined, '', 'nope', 'letmein-482', 'LETMEIN-4821']) {
    _resetForTests();
    const calls = [];
    const out = await run(makeHandler({ env: ENV, fetchFn: fakeSpond(calls), ...fast }), { code, ip: '9.9.9.' + String(code).length });
    assert.equal(out.status, 401, String(code));
    assert.equal(calls.length, 0);
  }
});

test('repeated wrong codes get locked out, even for the right code afterwards', async () => {
  _resetForTests();
  const h = makeHandler({ env: ENV, fetchFn: fakeSpond([]), ...fast });
  for (let i = 0; i < 6; i++) assert.equal((await run(h, { code: 'bad' + i, ip: '5.5.5.5' })).status, 401);
  assert.equal((await run(h, { code: 'bad', ip: '5.5.5.5' })).status, 429);
  assert.equal((await run(h, { code: 'letmein-4821', ip: '5.5.5.5' })).status, 429);
  assert.equal((await run(h, { code: 'letmein-4821', ip: '6.6.6.6' })).status, 200, 'other people are not affected');
});

test('not configured: says so, and does not run', async () => {
  _resetForTests();
  const out = await run(makeHandler({ env: { SPOND_EMAIL: 'x' }, fetchFn: fakeSpond([]), ...fast }), { code: 'x' });
  assert.equal(out.status, 503);
});

test('only GET is accepted', async () => {
  _resetForTests();
  assert.equal((await run(makeHandler({ env: ENV, fetchFn: fakeSpond([]), ...fast }), { method: 'POST', code: 'letmein-4821' })).status, 405);
});

test('Spond sign-in failure gives a clear 502 without leaking details', async () => {
  _resetForTests();
  const out = await run(makeHandler({ env: ENV, fetchFn: fakeSpond([], { loginOk: false }), ...fast }), { code: 'letmein-4821' });
  assert.equal(out.status, 502);
  assert.deepEqual(out.body, { error: 'spond-login' });
});

test('an expired Spond token is renewed once and the request still works', async () => {
  _resetForTests();
  const calls = [];
  const out = await run(makeHandler({ env: ENV, fetchFn: fakeSpond(calls, { expire: true }), ...fast }), { code: 'letmein-4821' });
  assert.equal(out.status, 200);
  assert.equal(calls.filter((c) => c.url.endsWith('auth2/login')).length, 2);
});

test('results are cached for under a minute so a busy night does not hammer Spond', async () => {
  _resetForTests();
  const calls = [];
  let t = new Date('2026-10-28T18:00:00Z');
  const h = makeHandler({ env: ENV, fetchFn: fakeSpond(calls), now: () => t, ...fast });
  await run(h, { code: 'letmein-4821' });
  const before = calls.length;
  t = new Date(t.getTime() + 20_000);
  await run(h, { code: 'letmein-4821' });
  assert.equal(calls.length, before, 'second request within 45s uses the cache');
  t = new Date(t.getTime() + 60_000);
  await run(h, { code: 'letmein-4821' });
  assert.ok(calls.length > before, 'after a minute it asks Spond again');
});
