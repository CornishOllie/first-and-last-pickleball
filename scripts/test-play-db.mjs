// Checks the play night database rules against the real Supabase project, using throw-away test users.
// Usage: node scripts/test-play-db.mjs      (needs the Supabase CLI logged in; touches only rows it creates)
import { execSync } from 'node:child_process';

const REF = 'bybbgwppshsaehkozgnx';
const URL_ = `https://${REF}.supabase.co`;
const keys = JSON.parse(execSync(`supabase projects api-keys --project-ref ${REF} -o json`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString());
const ANON = keys.find((k) => k.name === 'anon').api_key;
const SVC = keys.find((k) => k.name === 'service_role').api_key;

let failed = 0;
const ok = (name, cond, extra = '') => {
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra && !cond ? '  ' + extra : ''));
  if (!cond) failed++;
};
const H = (token, key = ANON) => ({ apikey: key, Authorization: `Bearer ${token ?? key}`, 'Content-Type': 'application/json', Prefer: 'return=representation' });
const call = async (path, { method = 'GET', token, key, body } = {}) => {
  const r = await fetch(URL_ + path, { method, headers: H(token ?? key, key ?? ANON), body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, body: json };
};
const rpc = (fn, args, token) => call(`/rest/v1/rpc/${fn}`, { method: 'POST', token, body: args ?? {} });
const svc = (path, opts = {}) => call(path, { ...opts, key: SVC, token: SVC });

const stamp = Date.now();
const pw = `T3st-${stamp}-pw!`;
const created = { users: [], sessions: [] };
const mkUser = async (label) => {
  const email = `t-${label}-${stamp}@example.test`;
  const r = await svc('/auth/v1/admin/users', { method: 'POST', body: { email, password: pw, email_confirm: true } });
  if (!r.body.id) throw new Error('could not create user ' + JSON.stringify(r.body));
  created.users.push(r.body.id);
  const t = await call('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password: pw } });
  return { id: r.body.id, email, token: t.body.access_token };
};

// ---------- a small independent calculation of what the answers should be ----------
let seed = 12345;
const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
const names = ['ann', 'bob', 'cat', 'dan', 'eve', 'fay'];
const games = [];
for (let i = 0; i < 24; i++) {
  const pool = [...names];
  const four = [];
  while (four.length < 4) four.push(pool.splice(rnd(pool.length), 1)[0]);
  const a = rnd(2) ? 11 : rnd(10);
  const b = a === 11 ? rnd(10) : 11;
  games.push({ round: i + 1, court: 1, a: [four[0], four[1]], b: [four[2], four[3]], score_a: a, score_b: b });
}
const expect = (who, list = games) => {
  const e = { games: 0, won: 0, lost: 0, pf: 0, pa: 0 };
  for (const g of list) {
    const inA = g.a.includes(who), inB = g.b.includes(who);
    if (!inA && !inB) continue;
    const pf = inA ? g.score_a : g.score_b, pa = inA ? g.score_b : g.score_a;
    e.games++; e.pf += pf; e.pa += pa; if (pf > pa) e.won++; else if (pf < pa) e.lost++;
  }
  return e;
};
const gamesB = [{ round: 1, court: 1, a: ['ann', 'bob'], b: ['cat', 'dan'], score_a: 11, score_b: 0 }];

try {
  // ---------- people ----------
  const host = await mkUser('host');
  const U = {};
  for (const n of ['ann', 'bob', 'cat', 'dan', 'eve']) U[n] = await mkUser(n);
  const stranger = await mkUser('stranger');
  const notHost = await mkUser('nothost');
  const h = (x) => host.token;
  await svc('/rest/v1/play_hosts', { method: 'POST', body: { user_id: host.id, name: 'Test host' } });

  // ---------- sessions and publishing ----------
  const sidA = crypto.randomUUID(), sidB = crypto.randomUUID();
  created.sessions.push(sidA, sidB);
  let r = await call('/rest/v1/play_sessions', { method: 'POST', token: host.token, body: [
    { id: sidA, name: 'Test night A', session_date: '2026-09-01', ended: true, state: {} },
    { id: sidB, name: 'Test night B', session_date: '2099-01-01', ended: false, state: {} },
  ] });
  ok('host can save sessions', r.status === 201, JSON.stringify(r.body).slice(0, 120));

  const players = [
    { key: 'ann', name: `T-Ann ${stamp}`, gender: 'F', status: 'attended' },
    { key: 'bob', name: `T-Bob ${stamp}`, gender: 'M', status: 'attended' },
    { key: 'cat', name: `T-Cat ${stamp}`, gender: 'F', status: 'attended' },
    { key: 'dan', name: `T-Dan ${stamp}`, gender: 'M', status: 'attended' },
    { key: 'eve', name: `T-Eve ${stamp}`, gender: 'F', status: 'walk_in' },
    { key: 'fay', name: `T-Fay ${stamp}`, gender: 'F', status: 'no_show' },
    { key: 'gus', name: `T-Gus ${stamp}`, gender: 'M', status: 'cancelled' },
  ];
  r = await rpc('play_publish_facts', { p_session: sidA, p_players: players, p_games: games }, notHost.token);
  ok('a signed-in non-host can not publish', r.status >= 400, r.status);
  r = await rpc('play_publish_facts', { p_session: sidA, p_players: players, p_games: games });
  ok('signed-out can not publish', r.status >= 400, r.status);
  r = await rpc('play_publish_facts', { p_session: sidA, p_players: players, p_games: games }, host.token);
  ok('host can publish a session', r.status === 200 && r.body.ann, JSON.stringify(r.body).slice(0, 150));
  const map = r.body;
  await rpc('play_publish_facts', { p_session: sidB, p_players: players.slice(0, 4), p_games: gamesB }, host.token);

  r = await rpc('play_publish_facts', { p_session: sidA, p_players: players, p_games: games }, host.token);
  const again = await svc(`/rest/v1/play_games?session_id=eq.${sidA}&select=id`);
  ok('publishing twice does not duplicate games', again.body.length === games.length, `${again.body.length}`);
  const att = await svc(`/rest/v1/play_attendance?session_id=eq.${sidA}&select=member_id`);
  ok('publishing twice does not duplicate attendance', att.body.length === players.length, `${att.body.length}`);

  // host sets emails (different case), junior and opt-out flags
  const patch = (key, body) => call(`/rest/v1/play_members?id=eq.${map[key]}`, { method: 'PATCH', token: host.token, body });
  r = await patch('ann', { email: U.ann.email.toUpperCase() }); ok('host can set a member email', r.status === 200);
  await patch('bob', { email: U.bob.email });
  await patch('cat', { email: U.cat.email, show_stats: false });
  await patch('dan', { email: U.dan.email, is_junior: true, guardian_ok: false });
  await patch('eve', { email: U.eve.email, is_junior: true, guardian_ok: true });

  // ---------- locked down tables ----------
  for (const t of ['play_members', 'play_sessions', 'play_attendance', 'play_games', 'play_ratings', 'play_hosts']) {
    const x = await call(`/rest/v1/${t}?select=*`, { token: U.ann.token });
    ok(`a player can not read ${t} directly`, Array.isArray(x.body) ? x.body.length === 0 : x.status >= 400, `${x.status}`);
    const y = await call(`/rest/v1/${t}?select=*`);
    ok(`signed-out can not read ${t}`, Array.isArray(y.body) ? y.body.length === 0 : y.status >= 400, `${y.status}`);
  }
  r = await call(`/rest/v1/play_members?id=eq.${map.bob}`, { method: 'PATCH', token: U.ann.token, body: { show_stats: false } });
  const bobRow = await svc(`/rest/v1/play_members?id=eq.${map.bob}&select=show_stats`);
  ok('a player can not edit someone else', bobRow.body[0].show_stats === true);
  r = await call('/rest/v1/play_hosts', { method: 'POST', token: U.ann.token, body: { user_id: U.ann.id, name: 'sneaky' } });
  ok('a player can not make themselves a host', r.status >= 400);
  for (const fn of ['play_sides']) {
    r = await rpc(fn, { p_since: null }, U.ann.token);
    ok(`${fn} is not callable by players`, r.status >= 400, r.status);
  }
  r = await rpc('play_host_summary', {}, U.ann.token); ok('player can not see the host summary', r.status >= 400, r.status);
  r = await rpc('play_merge_members', { p_keep: map.ann, p_drop: map.bob }, U.ann.token); ok('player can not merge members', r.status >= 400, r.status);
  for (const [fn, args] of [['play_my_stats', {}], ['play_leaderboard', {}], ['play_link_me', {}], ['play_set_visibility', { p_show: false }]]) {
    r = await rpc(fn, args);
    ok(`signed-out can not call ${fn}`, r.status >= 400, r.status);
  }

  // ---------- linking ----------
  r = await rpc('play_link_me', {}, stranger.token);
  ok('a stranger (no matching email) links to nothing', Array.isArray(r.body) && r.body.length === 0, JSON.stringify(r.body));
  r = await rpc('play_my_stats', {}, stranger.token);
  ok('a stranger gets no stats', r.body === null);
  r = await rpc('play_leaderboard', { p_min_games: 1 }, stranger.token);
  ok('a stranger gets no leaderboard', Array.isArray(r.body) && r.body.length === 0);
  for (const n of ['ann', 'bob', 'cat', 'dan', 'eve']) {
    r = await rpc('play_link_me', {}, U[n].token);
    ok(`${n} links to their own record (email match ignores case)`, r.status === 200 && r.body.length === 1 && r.body[0].name.startsWith(`T-${n[0].toUpperCase()}${n.slice(1)}`), JSON.stringify(r.body));
  }
  r = await rpc('play_link_me', {}, U.ann.token);
  ok('linking again is harmless', r.body.length === 1);
  const mem = await svc(`/rest/v1/play_members?id=eq.${map.ann}&select=user_id`);
  ok('the link is stored', mem.body[0].user_id === U.ann.id);

  // ---------- my own stats ----------
  r = await rpc('play_my_stats', {}, U.ann.token);
  const exp = expect('ann');
  const g = r.body?.games ?? {};
  ok('own games, wins, losses match an independent calculation', g.games === exp.games && g.won === exp.won && g.lost === exp.lost && g.points_for === exp.pf && g.points_against === exp.pa, JSON.stringify({ got: g, exp }));
  ok('the unfinished future session is not counted', g.games === exp.games);
  ok('own attendance is shown to the player', r.body.attendance.attended === 1 && r.body.attendance.no_shows === 0);
  const fay = await svc(`/rest/v1/play_members?id=eq.${map.fay}&select=id`);
  ok('partners are listed with a record', r.body.partners.length >= 1 && r.body.partners[0].games >= 1);
  ok('an opted-out partner is shown as "Another player", not by name', !JSON.stringify(r.body.partners).includes('T-Cat') && !JSON.stringify(r.body.partners).includes('T-Dan'));
  ok('recent sessions list only the finished session', r.body.recent.length === 1 && r.body.recent[0].name === 'Test night A');
  const noShowCheck = await rpc('play_my_stats', {}, U.cat.token);
  ok('an opted-out player still sees their own stats', noShowCheck.body?.games.games === expect('cat').games);

  // ---------- leaderboard rules ----------
  r = await rpc('play_leaderboard', { p_min_games: 1 }, U.ann.token);
  const lb = r.body.map((x) => x.name);
  ok('leaderboard includes visible adults', lb.includes(`T-Ann ${stamp}`) && lb.includes(`T-Bob ${stamp}`), JSON.stringify(lb));
  ok('leaderboard hides someone who opted out', !lb.includes(`T-Cat ${stamp}`));
  ok('leaderboard hides a junior without a parent OK', !lb.includes(`T-Dan ${stamp}`));
  ok('leaderboard shows a junior once a parent has said yes', lb.includes(`T-Eve ${stamp}`));
  ok('leaderboard rows carry games only: no attendance fields', r.body.every((x) => !('attended' in x) && !('no_shows' in x) && !('cancelled' in x) && !('status' in x)));
  const annRow = r.body.find((x) => x.is_me);
  ok('the player is marked as me, with correct numbers', annRow?.name === `T-Ann ${stamp}` && annRow.games === exp.games && annRow.won === exp.won, JSON.stringify(annRow));
  const sorted = r.body.every((x, i, a) => i === 0 || a[i - 1].win_pct >= x.win_pct);
  ok('ordered by win percentage', sorted);
  r = await rpc('play_leaderboard', {}, U.ann.token);
  ok('the default minimum of 6 games filters the table', r.body.every((x) => x.games >= 6));
  r = await rpc('play_leaderboard', { p_since: '2099-01-02', p_min_games: 1 }, U.ann.token);
  ok('a date filter excludes older games', r.body.length === 0);
  r = await rpc('play_leaderboard', { p_min_games: 1 }, U.cat.token);
  ok('someone who opted out does not see the leaderboard', r.body.length === 0);
  r = await rpc('play_leaderboard', { p_min_games: 1 }, U.dan.token);
  ok('a junior without a parent OK is not on it', !r.body.some((x) => x.name === `T-Dan ${stamp}`));

  // ---------- opting out and back in ----------
  r = await rpc('play_set_visibility', { p_show: false }, U.ann.token);
  ok('a player can opt out', r.status === 204 || r.status === 200, r.status);
  r = await rpc('play_leaderboard', { p_min_games: 1 }, U.bob.token);
  ok('after opting out, the player disappears from others\' boards', !r.body.some((x) => x.name === `T-Ann ${stamp}`));
  r = await rpc('play_leaderboard', { p_min_games: 1 }, U.ann.token);
  ok('and does not see the board themselves', r.body.length === 0);
  await rpc('play_set_visibility', { p_show: true }, U.ann.token);
  r = await rpc('play_leaderboard', { p_min_games: 1 }, U.bob.token);
  ok('opting back in restores them', r.body.some((x) => x.name === `T-Ann ${stamp}`));
  const bobStill = await svc(`/rest/v1/play_members?id=eq.${map.bob}&select=show_stats`);
  ok('opting out only affects the player who did it', bobStill.body[0].show_stats === true);

  // ---------- host summary ----------
  r = await rpc('play_host_summary', {}, host.token);
  const row = (k) => r.body.find((x) => x.member_id === map[k]);
  ok('host sees no-shows', row('fay')?.no_shows === 1 && row('gus')?.cancelled === 1 && row('ann')?.attended === 1, JSON.stringify(row('fay')));
  ok('host summary matches the games', row('bob').games === expect('bob').games && row('bob').won === expect('bob').won);

  // ---------- merge a duplicate ----------
  const dupe = await call('/rest/v1/play_members', { method: 'POST', token: host.token, body: { name: `T-Annie ${stamp}`, gender: 'F' } });
  const dupeId = dupe.body[0].id;
  await svc('/rest/v1/play_attendance', { method: 'POST', body: { session_id: sidB, member_id: dupeId, status: 'attended' } });
  await svc('/rest/v1/play_games', { method: 'POST', body: { session_id: sidA, round_no: 99, court: 1, a1: dupeId, a2: map.bob, b1: map.cat, b2: map.dan, score_a: 11, score_b: 2 } });
  r = await rpc('play_merge_members', { p_keep: map.ann, p_drop: dupeId }, host.token);
  ok('host can merge duplicates', r.status === 204 || r.status === 200, r.status);
  const gone = await svc(`/rest/v1/play_members?id=eq.${dupeId}&select=id`);
  ok('the duplicate is removed', gone.body.length === 0);
  const moved = await svc(`/rest/v1/play_games?round_no=eq.99&session_id=eq.${sidA}&select=a1`);
  ok('its games now belong to the right person', moved.body[0].a1 === map.ann);
  const att2 = await svc(`/rest/v1/play_attendance?session_id=eq.${sidB}&member_id=eq.${map.ann}&select=status`);
  ok('its attendance moved too', att2.body.length === 1);
  const still = await svc(`/rest/v1/play_members?id=eq.${map.ann}&select=user_id,email`);
  ok('the kept person keeps their sign-in link and email', still.body[0].user_id === U.ann.id && !!still.body[0].email);

  // ---------- erasing a person ----------
  const before = await svc(`/rest/v1/play_games?session_id=eq.${sidA}&select=id`);
  r = await call(`/rest/v1/play_members?id=eq.${map.fay}`, { method: 'DELETE', token: host.token });
  ok('host can erase a person', r.status === 204 || r.status === 200, r.status);
  const attAfter = await svc(`/rest/v1/play_attendance?member_id=eq.${map.fay}&select=member_id`);
  ok('their attendance is gone', attAfter.body.length === 0);
  const after = await svc(`/rest/v1/play_games?session_id=eq.${sidA}&select=id`);
  ok('other players\' games are kept', after.body.length === before.body.length);
  const dnull = await svc(`/rest/v1/play_games?session_id=eq.${sidA}&select=a1,a2,b1,b2`);
  ok('an erased person is removed from the games, not left as an id', !JSON.stringify(dnull.body).includes(map.fay));
} catch (e) {
  failed++;
  console.log('FAIL test run crashed:', e.message);
} finally {
  for (const id of created.sessions) await svc(`/rest/v1/play_sessions?id=eq.${id}`, { method: 'DELETE' });
  await svc(`/rest/v1/play_members?name=like.T-*%20${stamp}`, { method: 'DELETE' });
  for (const id of created.users) {
    await svc(`/rest/v1/play_hosts?user_id=eq.${id}`, { method: 'DELETE' });
    await svc(`/auth/v1/admin/users/${id}`, { method: 'DELETE' });
  }
  const left = await svc(`/rest/v1/play_members?name=like.T-*%20${stamp}&select=id`);
  console.log(left.body.length === 0 ? 'cleaned up test users and rows' : 'WARNING: test rows left behind');
}
console.log(failed ? `\n${failed} FAILED` : '\nall checks passed');
process.exit(failed ? 1 : 0);
