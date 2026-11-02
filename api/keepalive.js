// GET /api/keepalive   Called once a day by a Vercel cron (vercel.json).
// Supabase pauses a free project after a week with no requests. One tiny read a day keeps it awake.
export function makeHandler({ env = process.env, fetchFn = fetch } = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    const url = env.PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
    const key = env.PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) return res.status(503).json({ ok: false, error: 'not-set-up' });
    try {
      const r = await fetchFn(`${url}/rest/v1/clubs?select=id&limit=1`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
      return res.status(r.ok ? 200 : 502).json({ ok: r.ok });
    } catch {
      return res.status(502).json({ ok: false, error: 'network' });
    }
  };
}

export default makeHandler();
