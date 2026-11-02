// POST /api/demo-login   body: { who: 'host' | 'sam' | 'kit' | 'jo' }
// Demo sign-in for the committee preview build only. It does nothing unless DEMO_MODE is 'on', which is set
// on the one preview deployment and nowhere else. Answers 404 otherwise, so the live site looks as if it
// does not exist.
// The client never sends an email: `who` is looked up in a fixed list of made-up demo.invalid accounts.
// It asks Supabase for a sign-in token and returns only { email, token_hash }. The action link (which
// signs anyone in who opens it) is never returned. No email is sent.
const DEMO = {
  host: 'host@demo.invalid',
  sam: 'sam@demo.invalid',
  kit: 'kit@demo.invalid',
  jo: 'jo@demo.invalid',
};
const LIMIT = { count: 20, windowMs: 10 * 60 * 1000 };
const hits = new Map();

export function makeHandler({ env = process.env, fetchFn = fetch, now = () => Date.now() } = {}) {
  return async function handler(req, res) {
    const send = (status, body) => {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Type', 'application/json');
      res.status(status).send(JSON.stringify(body));
    };
    if (env.DEMO_MODE !== 'on' || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return send(404, { error: 'not-found' });
    if (req.method !== 'POST') return send(405, { error: 'method' });

    const ip = String(req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || 'x').split(',')[0].trim();
    const t = now();
    const recent = (hits.get(ip) || []).filter((x) => t - x < LIMIT.windowMs);
    if (recent.length >= LIMIT.count) return send(429, { error: 'slow-down' });
    hits.set(ip, [...recent, t]);

    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
    const who = typeof body?.who === 'string' ? body.who : '';
    if (!Object.prototype.hasOwnProperty.call(DEMO, who)) return send(400, { error: 'who' });
    const email = DEMO[who];

    try {
      const r = await fetchFn(`${env.SUPABASE_URL}/auth/v1/admin/generate_link`, {
        method: 'POST',
        headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'magiclink', email }),
      });
      if (!r.ok) return send(502, { error: 'link' });
      const j = await r.json();
      if (typeof j?.hashed_token !== 'string' || !j.hashed_token) return send(502, { error: 'link' });
      return send(200, { email, token_hash: j.hashed_token });
    } catch {
      return send(502, { error: 'network' });
    }
  };
}

export default makeHandler();
export const _resetForTests = () => hits.clear();
