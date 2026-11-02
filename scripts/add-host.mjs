// Adds a host (or admin) for one club. They can sign in to /host on that club's site and see that club's members.
// Usage: node scripts/add-host.mjs someone@example.com "Their Name" [--club first-and-last] [--role host|admin]
// Needs the Supabase CLI logged in. Never prints keys. Hosts sign in with an emailed code, no password.
import { execSync } from 'node:child_process';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const clubSlug = flag('club', 'first-and-last');
const role = flag('role', 'host');
const [email, ...rest] = args;
const name = rest.join(' ').trim();
const usage = 'Usage: node scripts/add-host.mjs someone@example.com "Their Name" [--club first-and-last] [--role host|admin]';
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !['host', 'admin'].includes(role)) {
  console.log(usage);
  process.exit(1);
}
const REF = 'bybbgwppshsaehkozgnx';
const URL_ = `https://${REF}.supabase.co`;
const keys = JSON.parse(execSync(`supabase projects api-keys --project-ref ${REF} -o json`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString());
const SVC = keys.find((k) => k.name === 'service_role').api_key;
const H = { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json', Prefer: 'return=representation,resolution=merge-duplicates' };

const lower = email.trim().toLowerCase();
let id;
const made = await fetch(`${URL_}/auth/v1/admin/users`, { method: 'POST', headers: H, body: JSON.stringify({ email: lower, email_confirm: true }) });
if (made.ok) id = (await made.json()).id;
else if (made.status === 422) {
  for (let page = 1; page < 20 && !id; page++) {
    const list = await (await fetch(`${URL_}/auth/v1/admin/users?page=${page}&per_page=200`, { headers: H })).json();
    id = (list.users ?? []).find((u) => u.email?.toLowerCase() === lower)?.id;
    if (!list.users?.length) break;
  }
}
if (!id) { console.log('Could not create or find that account.'); process.exit(1); }
const club = (await (await fetch(`${URL_}/rest/v1/clubs?slug=eq.${encodeURIComponent(clubSlug)}&select=id,name`, { headers: H })).json())[0];
if (!club) { console.log(`No club with slug "${clubSlug}".`); process.exit(1); }
const res = await fetch(`${URL_}/rest/v1/club_roles?on_conflict=club_id,user_id`, { method: 'POST', headers: H, body: JSON.stringify({ club_id: club.id, user_id: id, role, name: name || lower }) });
if (!res.ok) { console.log('Could not add the host:', res.status); process.exit(1); }
console.log(`Added ${lower} as ${role} of ${club.name}. They can now sign in at /host with an emailed code.`);
