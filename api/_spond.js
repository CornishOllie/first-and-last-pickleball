// Talks to Spond's own (unofficial, undocumented) web API using a normal member account.
// Pure functions that take a fetch function, so they can be tested without the network.
const BASE = 'https://api.spond.com/core/v1/';

export async function spondLogin(fetchFn, email, password) {
  const res = await fetchFn(`${BASE}auth2/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error('spond-login');
  const body = await res.json();
  const token = body?.accessToken?.token ?? body?.token;
  if (!token) throw new Error('spond-login');
  return token;
}

const stamp = (d) => d.toISOString().slice(0, 19) + '.000Z';

/** Upcoming events from now minus a few hours to the next `days` days. */
export async function fetchEvents(fetchFn, token, now, days = 8) {
  const params = new URLSearchParams({
    max: '60',
    scheduled: 'true',
    order: 'asc',
    minEndTimestamp: stamp(new Date(now.getTime() - 60 * 60 * 1000)),
    maxStartTimestamp: stamp(new Date(now.getTime() + days * 24 * 60 * 60 * 1000)),
  });
  const res = await fetchFn(`${BASE}sponds/?${params}`, { headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' } });
  if (!res.ok) throw new Error('spond-events');
  const body = await res.json();
  return Array.isArray(body) ? body : [];
}

export async function fetchGroups(fetchFn, token) {
  const res = await fetchFn(`${BASE}groups/`, { headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' } });
  if (!res.ok) return [];
  const body = await res.json();
  return Array.isArray(body) ? body : [];
}

const fullName = (m) => [m?.firstName, m?.lastName].filter(Boolean).join(' ').trim();

/** Turn Spond's raw events into just what the play tool needs: who is coming, and who is on the waiting list.
 *  Declined and unanswered people are deliberately not passed on. Only groups whose name contains `groupMatch`. */
export function shapeEvents(events, groups, groupMatch) {
  const want = (groupMatch || '').trim().toLowerCase();
  const nameById = new Map();
  for (const g of groups || []) for (const m of g.members || []) nameById.set(m.id, fullName(m));
  const out = [];
  for (const e of events || []) {
    if (e.cancelled) continue;
    const g = e.recipients?.group;
    const groupName = g?.name ?? '';
    if (want && !groupName.toLowerCase().includes(want)) continue;
    const local = new Map(nameById);
    for (const m of g?.members || []) local.set(m.id, fullName(m));
    const names = (ids) => (ids || []).map((id) => local.get(id)).filter(Boolean);
    out.push({
      id: e.id,
      heading: e.heading ?? 'Event',
      group: groupName,
      start: e.startTimestamp ?? null,
      accepted: names(e.responses?.acceptedIds),
      waiting: names(e.responses?.waitinglistIds),
    });
  }
  return out.sort((a, b) => String(a.start).localeCompare(String(b.start)));
}
