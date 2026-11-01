// Adds a host who can sign in to /host (the play night tool) and see every member's record.
// Usage: node scripts/add-host.mjs someone@example.com "Their Name"
// Needs the Supabase CLI logged in. Never prints keys. Hosts sign in with an emailed link, no password.
import { execSync } from 'node:child_process';

const [email, ...rest] = process.argv.slice(2);
const name = rest.join(' ').trim();
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.log('Usage: node scripts/add-host.mjs someone@example.com "Their Name"');
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
const res = await fetch(`${URL_}/rest/v1/play_hosts?on_conflict=user_id`, { method: 'POST', headers: H, body: JSON.stringify({ user_id: id, name: name || lower }) });
if (!res.ok) { console.log('Could not add the host:', res.status); process.exit(1); }
console.log(`Added ${lower} as a host. They can now sign in at /host with an emailed link.`);
