// Demo data for trying the shared stats locally. Never touches the live website: it only fills the Supabase
// project with clearly fake people (emails end @demo.invalid) and fake sessions (names start "DEMO").
//   node scripts/demo.mjs seed     make the fake players, nights and games
//   node scripts/demo.mjs open host|sam|kit|jo    open a sign-in link in the browser (http://localhost:4321)
//   node scripts/demo.mjs clean    remove everything demo (members, sessions, games, demo accounts)
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
  await api(`/rest/v1/play_members?email=like.*${DOMAIN}`, 'DELETE');
  if (hostId) { await api(`/rest/v1/play_hosts?user_id=eq.${hostId}`, 'DELETE'); await api(`/auth/v1/admin/users/${hostId}`, 'DELETE'); }
  for (const [n] of people) { const id = await findUser(demoEmail(n)); if (id) await api(`/auth/v1/admin/users/${id}`, 'DELETE'); }
  console.log('Demo data removed.');
}

async function seedAll() {
  await clean();
  const hostId = await ensureUser(`host${DOMAIN}`);
  await api('/rest/v1/play_hosts', 'POST', { user_id: hostId, name: 'Demo host' });

  const members = await api('/rest/v1/play_members', 'POST',
    people.map(([name, gender, f]) => ({ name, gender, email: demoEmail(name), is_junior: false, guardian_ok: false, show_stats: true, ...f })));
  const byName = Object.fromEntries(members.map((m) => [m.name, m.id]));
  for (const n of ['Sam Carter', 'Kit Morgan', 'Jo Trelawny']) await ensureUser(demoEmail(n));

  // Eight weekly nights, newest a week ago.
  const today = new Date();
  const adults = people.map((p) => p[0]);
  for (let w = 8; w >= 1; w--) {
    const d = new Date(today); d.setDate(d.getDate() - 7 * w);
    const date = d.toISOString().slice(0, 10);
    const sid = crypto.randomUUID();
    await api('/rest/v1/play_sessions', 'POST', { id: sid, name: `DEMO Thursday night ${date}`, session_date: date, ended: true, state: {} });
    const pool = [...adults];
    const here = [];
    const count = 8 + rnd(5);
    while (here.length < count) here.push(pool.splice(rnd(pool.length), 1)[0]);
    const att = here.map((n, i) => ({ session_id: sid, member_id: byName[n], status: i === 0 && w % 3 === 0 ? 'walk_in' : 'attended' }));
    for (const n of pool.slice(0, 2)) att.push({ session_id: sid, member_id: byName[n], status: rnd(2) ? 'no_show' : 'cancelled' });
    await api('/rest/v1/play_attendance', 'POST', att);
    const games = [];
    for (let round = 1; round <= 6; round++) {
      const order = [...here].sort(() => rnd(3) - 1);
      for (let c = 0; c < Math.floor(order.length / 4); c++) {
        const q = order.slice(c * 4, c * 4 + 4).map((n) => byName[n]);
        const a = rnd(2) ? 11 : rnd(10); const b = a === 11 ? rnd(10) : 11;
        games.push({ session_id: sid, round_no: round, court: c + 1, a1: q[0], a2: q[1], b1: q[2], b2: q[3], score_a: a, score_b: b });
      }
    }
    await api('/rest/v1/play_games', 'POST', games);
  }
  console.log(`Seeded ${people.length} demo players, 8 nights. Host login: host${DOMAIN}. Player logins: sam, kit (stats off), jo (junior, no parent OK).`);
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
