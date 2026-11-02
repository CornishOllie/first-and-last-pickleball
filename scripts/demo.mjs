// Demo data for trying the shared stats locally. Never touches the live website: it only fills the Supabase
// project with clearly fake people (emails end @demo.invalid) and fake sessions (names start "DEMO").
//   node scripts/demo.mjs seed     make the fake players, nights and games
//   node scripts/demo.mjs open host|sam|kit|jo    open a sign-in link in the browser (http://localhost:4321)
//   node scripts/demo.mjs clean    remove everything demo (members, sessions, games, demo accounts, the demo club)
// Two clubs: F&L (the real club row, demo people only) and "DEMO Riverside", a fake second club. Sam is in both.
// Needs the Supabase CLI logged in. Never prints keys or sign-in links.
import { execSync } from 'node:child_process';

const REF = 'bybbgwppshsaehkozgnx';
const URL_ = `https://${REF}.supabase.co`;
const keys = JSON.parse(execSync(`supabase projects api-keys --project-ref ${REF} -o json`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString());
const SVC = keys.find((k) => k.name === 'service_role').api_key;
const H = { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };
const api = async (path, method = 'GET', body) => {
  const r = await fetch(URL_ + path, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = t; }
  if (!r.ok) throw new Error(`${method} ${path} ${r.status} ${t.slice(0, 200)}`);
  return j;
};

const DOMAIN = '@demo.invalid';
const FL = '8c272569-0e18-46a7-be5b-e9dbaef31b1a';
const RIVER = 'ef4da995-8d42-4629-bec2-ccb982b955ce';
// Riverside's own people, plus Sam (same email as at F&L, so one sign-in sees both clubs).
const riverPeople = [
  ['Sam Carter', 'M', 'sam'], ['Alys Pender', 'F', 'alys'], ['Gwen Tonkin', 'F', 'gwen'], ['Jack Uren', 'M', 'jack'],
  ['Nell Rodda', 'F', 'nell'], ['Will Opie', 'M', 'will'], ['Tamsin Hosken', 'F', 'tamsin'], ['Ned Bray', 'M', 'ned'],
];
const people = [
  // name, gender, flags. sam, kit and jo get sign-ins.
  ['Sam Carter', 'M', {}], ['Kit Morgan', 'F', { show_stats: false }], ['Jo Trelawny', 'F', { is_junior: true }],
  ['Ben Roscorla', 'M', {}], ['Hannah Penrose', 'F', {}], ['Dave Pascoe', 'M', {}], ['Lowenna Hocking', 'F', {}],
  ['Tom Nance', 'M', {}], ['Ruth Angove', 'F', {}], ['Pete Tregear', 'M', {}], ['Morwenna Bolitho', 'F', {}],
  ['Colin Rowe', 'M', {}], ['Izzy Kitto', 'F', { is_junior: true, guardian_ok: true }], ['Matt Jago', 'M', {}],
];
const slug = (n) => n.split(' ')[0].toLowerCase();
const demoEmail = (n) => `${slug(n)}${DOMAIN}`;

let seed = 4242;
const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };

async function findUser(email) {
  for (let page = 1; page < 20; page++) {
    const list = await api(`/auth/v1/admin/users?page=${page}&per_page=200`);
    const u = (list.users ?? []).find((x) => x.email?.toLowerCase() === email);
    if (u) return u.id;
    if (!list.users?.length) break;
  }
  return null;
}
async function ensureUser(email) {
  const existing = await findUser(email);
  if (existing) return existing;
  return (await api('/auth/v1/admin/users', 'POST', { email, email_confirm: true })).id;
}

async function clean() {
  const sessions = await api('/rest/v1/play_sessions?select=id&name=like.DEMO*');
  for (const s of sessions) await api(`/rest/v1/play_sessions?id=eq.${s.id}`, 'DELETE');
  const hostId = await findUser(`host${DOMAIN}`);
  // Nights the demo host started while trying the tool.
  if (hostId) await api(`/rest/v1/play_sessions?created_by=eq.${hostId}`, 'DELETE');
  // The whole demo club.
  for (const t of ['play_ratings', 'play_sessions', 'play_members']) await api(`/rest/v1/${t}?club_id=eq.${RIVER}`, 'DELETE');
  await api(`/rest/v1/clubs?id=eq.${RIVER}`, 'DELETE');
  await api(`/rest/v1/play_members?email=like.*${DOMAIN}`, 'DELETE');
  // Deleting an account also removes its club roles.
  if (hostId) await api(`/auth/v1/admin/users/${hostId}`, 'DELETE');
  for (const [n] of people) { const id = await findUser(demoEmail(n)); if (id) await api(`/auth/v1/admin/users/${id}`, 'DELETE'); }
  console.log('Demo data removed.');
}

/** Weekly nights for one club: attendance, scored games and a full session state. */
async function seedNights(club, names, byName, gender, weeks, prefix) {
  const today = new Date();
  for (let w = weeks; w >= 1; w--) {
    const d = new Date(today); d.setDate(d.getDate() - 7 * w);
    const date = d.toISOString().slice(0, 10);
    const sid = crypto.randomUUID();
    const pool = [...names];
    const here = [];
    const count = Math.min(names.length, 8 + rnd(5));
    while (here.length < count) here.push(pool.splice(rnd(pool.length), 1)[0]);
    const att = here.map((n, i) => ({ session_id: sid, member_id: byName[n], status: i === 0 && w % 3 === 0 ? 'walk_in' : 'attended' }));
    for (const n of pool.slice(0, 2)) att.push({ session_id: sid, member_id: byName[n], status: rnd(2) ? 'no_show' : 'cancelled' });
    const games = [];
    const rounds = [];
    for (let round = 1; round <= 6; round++) {
      const order = [...here].sort(() => rnd(3) - 1);
      const matches = [];
      for (let c = 0; c < Math.floor(order.length / 4); c++) {
        const q = order.slice(c * 4, c * 4 + 4);
        const a = rnd(2) ? 11 : rnd(10); const b = a === 11 ? rnd(10) : 11;
        const ids = q.map((n) => byName[n]);
        games.push({ session_id: sid, round_no: round, court: c + 1, a1: ids[0], a2: ids[1], b1: ids[2], b2: ids[3], score_a: a, score_b: b });
        matches.push({ court: c + 1, a: [q[0], q[1]], b: [q[2], q[3]], scoreA: a, scoreB: b });
      }
      rounds.push({ number: round, matches, sitting: order.slice(matches.length * 4) });
    }
    // A full session state, so opening a DEMO night in the host app shows the night as it was played.
    const pid = (n) => 'd' + n.split(' ')[0].toLowerCase();
    const state = {
      id: sid, name: `${prefix} ${date}`, date, ended: true, pairs: [], ratings: {},
      settings: { format: 'mixer', courts: 4, gameMinutes: 12, changeoverMinutes: 3, preferMixed: false, balanceLevels: false },
      players: here.map((n) => ({ id: pid(n), name: n, gender: gender(n), level: 0, active: true, joinedRound: 1, memberId: byName[n] })),
      rounds: rounds.map((r) => ({ number: r.number, sitting: r.sitting.map(pid), matches: r.matches.map((m) => ({ court: m.court, a: m.a.map(pid), b: m.b.map(pid), scoreA: m.scoreA, scoreB: m.scoreB })) })),
    };
    await api('/rest/v1/play_sessions', 'POST', { id: sid, club_id: club, name: state.name, session_date: date, ended: true, state });
    await api('/rest/v1/play_attendance', 'POST', att);
    await api('/rest/v1/play_games', 'POST', games);
  }
}

async function seedAll() {
  await clean();
  const hostId = await ensureUser(`host${DOMAIN}`);
  await api('/rest/v1/club_roles', 'POST', { club_id: FL, user_id: hostId, role: 'admin', name: 'Demo host' });

  // F&L: demo people only, in the real club row.
  const members = await api('/rest/v1/play_members', 'POST',
    people.map(([name, gender, f]) => ({ club_id: FL, name, gender, email: demoEmail(name), is_junior: false, guardian_ok: false, show_stats: true, ...f })));
  const byName = Object.fromEntries(members.map((m) => [m.name, m.id]));
  for (const n of ['Sam Carter', 'Kit Morgan', 'Jo Trelawny']) await ensureUser(demoEmail(n));
  await seedNights(FL, people.map((p) => p[0]), byName, (n) => people.find((x) => x[0] === n)[1], 8, 'DEMO Thursday night');

  // A fake second club, so a player in two clubs can be tried.
  await api('/rest/v1/clubs', 'POST', { id: RIVER, slug: 'demo-riverside', name: 'DEMO Riverside Pickleball', short_name: 'Riverside' });
  const rm = await api('/rest/v1/play_members', 'POST',
    riverPeople.map(([name, gender, e]) => ({ club_id: RIVER, name, gender, email: `${e}${DOMAIN}`, is_junior: false, guardian_ok: false, show_stats: true })));
  const rBy = Object.fromEntries(rm.map((m) => [m.name, m.id]));
  await seedNights(RIVER, riverPeople.map((p) => p[0]), rBy, (n) => riverPeople.find((x) => x[0] === n)[1], 3, 'DEMO Riverside Monday');

  console.log(`Seeded ${people.length} F&L demo players with 8 nights, and DEMO Riverside with ${riverPeople.length} players and 3 nights.`);
  console.log(`Host login: host${DOMAIN} (admin of F&L). Players: sam (in both clubs), kit (stats off), jo (junior, no parent OK).`);
}

async function open(who) {
  const email = who === 'host' ? `host${DOMAIN}` : demoEmail(people.find((p) => slug(p[0]) === who)?.[0] ?? '');
  if (!email || email === DOMAIN) throw new Error('Use host, sam, kit or jo');
  const dest = who === 'host' ? '/host' : '/me';
  const r = await api('/auth/v1/admin/generate_link', 'POST', { type: 'magiclink', email, redirect_to: `http://localhost:4321${dest}` });
  execSync(`open "${r.action_link}"`);
  console.log(`Opened ${who} at localhost:4321${dest}.`);
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === 'seed') await seedAll();
else if (cmd === 'clean') await clean();
else if (cmd === 'open') await open(arg);
else console.log('Usage: node scripts/demo.mjs seed | open host|sam|kit|jo | clean');
