// Copies every play night table to dated JSON files on this Mac. Supabase's free tier has no backups we can restore.
// Usage: node scripts/backup-db.mjs [folder]      default folder: ~/Backups/pickleball-db
// The files hold members' names and emails, so they go outside the repo and are readable only by this user.
// Keeps the last 30 days. Needs the Supabase CLI logged in. Never prints keys.
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readdirSync, rmSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const REF = 'bybbgwppshsaehkozgnx';
const URL_ = `https://${REF}.supabase.co`;
const TABLES = ['clubs', 'club_roles', 'play_members', 'play_sessions', 'play_attendance', 'play_games', 'play_ratings'];
const KEEP_DAYS = 30;
const PAGE = 1000;

const root = process.argv[2] || join(homedir(), 'Backups', 'pickleball-db');
const keys = JSON.parse(execSync(`supabase projects api-keys --project-ref ${REF} -o json`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString());
const SVC = keys.find((k) => k.name === 'service_role').api_key;
const H = { apikey: SVC, Authorization: `Bearer ${SVC}` };

const day = new Date().toISOString().slice(0, 10);
const dir = join(root, day);
mkdirSync(dir, { recursive: true, mode: 0o700 });
chmodSync(root, 0o700);

let total = 0;
for (const t of TABLES) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const r = await fetch(`${URL_}/rest/v1/${t}?select=*`, { headers: { ...H, Range: `${from}-${from + PAGE - 1}`, 'Range-Unit': 'items' } });
    if (!r.ok) throw new Error(`${t}: ${r.status}`);
    const page = await r.json();
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  const file = join(dir, `${t}.json`);
  writeFileSync(file, JSON.stringify(rows, null, 1), { mode: 0o600 });
  total += rows.length;
  console.log(`${t}: ${rows.length}`);
}

// drop folders older than KEEP_DAYS
const cutoff = new Date(Date.now() - KEEP_DAYS * 86_400_000).toISOString().slice(0, 10);
for (const name of readdirSync(root)) if (/^\d{4}-\d{2}-\d{2}$/.test(name) && name < cutoff) rmSync(join(root, name), { recursive: true });

console.log(`Saved ${total} rows to ${dir}`);
