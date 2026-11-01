// POST /api/player-login   body: { email }
// Players sign in with an emailed link. Sign-ups are switched off in Supabase, so this is the only way an
// account is ever created, and only for an email that a host has put on a member record.
// It always answers the same way, so nobody can use it to find out who is a member.
const BASE_LIMIT = { count: 8, windowMs: 10 * 60 * 1000 };
const hits = new Map();

export function makeHandler({ env = process.env, fetchFn = fetch, now = () => Date.now() } = {}) {
  return async function handler(req, res) {
    const send = (status, body) => {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Type', 'application/json');
      res.status(status).send(JSON.stringify(body));
    };
    if (req.method !== 'POST') return send(405, { error: 'method' });
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return send(503, { error: 'not-set-up' });

    const ip = String(req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || 'x').split(',')[0].trim();
    const t = now();
    const recent = (hits.get(ip) || []).filter((x) => t - x < BASE_LIMIT.windowMs);
    if (recent.length >= BASE_LIMIT.count) return send(429, { error: 'slow-down' });
    hits.set(ip, [...recent, t]);

    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!email || email.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return send(400, { error: 'email' });

    const headers = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' };
    try {
      const known = await fetchFn(`${env.SUPABASE_URL}/rest/v1/rpc/play_email_known`, { method: 'POST', headers, body: JSON.stringify({ p_email: email }) });
      if (!known.ok) return send(502, { error: 'lookup' });
      if ((await known.json()) === true) {
        const made = await fetchFn(`${env.SUPABASE_URL}/auth/v1/admin/users`, { method: 'POST', headers, body: JSON.stringify({ email, email_confirm: true }) });
        // 422 means the account already exists, which is fine
        if (!made.ok && made.status !== 422) return send(502, { error: 'account' });
      }
      return send(200, { ok: true });
    } catch {
      return send(502, { error: 'network' });
    }
  };
}

export default makeHandler();
export const _resetForTests = () => hits.clear();
