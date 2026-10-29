// Live check against the real Spond using the saved private file. Prints counts and headings only, never passwords or names.
// Usage: node --env-file=$HOME/.config/play-night/spond.env scripts/check-spond-live.mjs
import { spondLogin, fetchEvents, fetchGroups, shapeEvents } from '../api/_spond.js';
const { SPOND_EMAIL, SPOND_PASSWORD, SPOND_GROUP_MATCH } = process.env;
if (!SPOND_EMAIL || !SPOND_PASSWORD) { console.log('Missing Spond settings. Run scripts/set-spond-secrets.sh first.'); process.exit(1); }
try {
  const token = await spondLogin(fetch, SPOND_EMAIL, SPOND_PASSWORD);
  console.log('sign-in: ok');
  const events = await fetchEvents(fetch, token, new Date());
  console.log('events in the next week (all groups):', events.length);
  const withMembers = events.filter((e) => e.recipients?.group?.members?.length).length;
  console.log('events that carry member names themselves:', withMembers, 'of', events.length);
  const groups = withMembers < events.length ? await fetchGroups(fetch, token) : [];
  if (groups.length) console.log('groups fetched as fallback:', groups.length);
  const shaped = shapeEvents(events, groups, SPOND_GROUP_MATCH ?? 'First & Last');
  console.log(`events for groups matching "${SPOND_GROUP_MATCH ?? 'First & Last'}":`, shaped.length);
  for (const e of shaped) console.log(' -', e.start?.slice(0, 16), '|', e.heading, '|', e.accepted.length, 'accepted,', e.waiting.length, 'waiting', e.accepted.some((n) => !n) ? '(some blank names!)' : '');
  const keys = events[0] ? Object.keys(events[0]).sort().join(', ') : '';
  if (keys) console.log('fields on an event:', keys);
  if (events[0]?.responses) console.log('response fields:', Object.keys(events[0].responses).sort().join(', '));
} catch (e) {
  console.log('FAILED:', e.message);
  process.exit(1);
}
