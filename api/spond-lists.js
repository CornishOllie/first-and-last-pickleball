// GET /api/spond-lists  (header: x-play-code)
// Fetches tonight's and the coming week's Spond sign-up lists for the club group, so hosts do not have to type names.
// Spond sign-in details live in server settings only. Responses are never cached.
import crypto from 'node:crypto';
import { spondLogin, fetchEvents, fetchGroups, shapeEvents } from './_spond.js';

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
const same = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));

const tries = new Map(); // ip -> recent timestamps (best effort, per warm instance)
const tooMany = (ip, now, limit, windowMs) => {
  const recent = (tries.get(ip) || []).filter((t) => now - t < windowMs);
  tries.set(ip, recent);
  return recent.length >= limit;
};

let cache = { token: null, tokenAt: 0, data: null, dataAt: 0 };

export function makeHandler({ env = process.env, fetchFn = fetch, now = () => new Date(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  return async function handler(req, res) {
    const send = (status, body) => {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Type', 'application/json');
      res.status(status).send(JSON.stringify(body));
    };
    if (req.method !== 'GET') return send(405, { error: 'method' });
    if (!env.SPOND_EMAIL || !env.SPOND_PASSWORD || !env.PLAY_LIST_CODE) return send(503, { error: 'not-set-up' });

    const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'x').split(',')[0].trim();
    const t = now().getTime();
    if (tooMany(ip, t, 6, 10 * 60 * 1000)) return send(429, { error: 'slow-down' });
    const given = req.headers['x-play-code'];
    if (typeof given !== 'string' || !given || !same(given, env.PLAY_LIST_CODE)) {
      tries.set(ip, [...(tries.get(ip) || []), t]);
      await sleep(1200);
      return send(401, { error: 'bad-code' });
    }

    try {
      if (cache.data && t - cache.dataAt < 45_000) return send(200, cache.data);
      const fresh = async () => {
        if (!cache.token || t - cache.tokenAt > 20 * 60 * 1000) {
          cache.token = await spondLogin(fetchFn, env.SPOND_EMAIL, env.SPOND_PASSWORD);
          cache.tokenAt = t;
        }
        const events = await fetchEvents(fetchFn, cache.token, now());
        const groups = events.some((e) => !e.recipients?.group?.members) ? await fetchGroups(fetchFn, cache.token) : [];
        return shapeEvents(events, groups, env.SPOND_GROUP_MATCH ?? 'First & Last');
      };
      let shaped;
      try {
        shaped = await fresh();
      } catch (e) {
        cache.token = null; // the token may have expired: sign in again once
        shaped = await fresh();
      }
      cache.data = { events: shaped, fetchedAt: now().toISOString() };
      cache.dataAt = t;
      return send(200, cache.data);
    } catch (e) {
      return send(502, { error: e?.message === 'spond-login' ? 'spond-login' : 'spond' });
    }
  };
}

export default makeHandler();
export const _resetForTests = () => { cache = { token: null, tokenAt: 0, data: null, dataAt: 0 }; tries.clear(); };
