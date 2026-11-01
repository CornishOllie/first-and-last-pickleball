import { useEffect, useState } from 'preact/hooks';
import './play.css';
import { daysAgo, leaderboard, linkMe, myStats, playerBackendOn, playerSignOut, requestLink, sessionInfo, setVisibility } from './playerApi.ts';
import type { BoardRow, MyRecord, MyStats } from './playerApi.ts';

type Period = 'all' | '90';
const pct = (won: number, games: number) => (games ? `${Math.round((100 * won) / games)}%` : '-');
const signed = (n: number) => (n > 0 ? `+${n}` : String(n));
const firstName = (n: string) => n.split(' ')[0];

function SignIn() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'sent' | 'too-many' | 'error'>('idle');
  return (
    <div class="card">
      <h2>Sign in</h2>
      <p class="muted">Use the email the club has for you. We will send you a link. No password needed.</p>
      {state === 'sent' ? (
        <div class="note">If that email is on the club's list, a sign-in link is on its way. Open it on this device. It can take a minute.</div>
      ) : (
        <form onSubmit={async (e) => { e.preventDefault(); setState('busy'); setState(await requestLink(email)); }}>
          <div class="field">
            <label for="pe">Email</label>
            <input id="pe" type="email" required autoComplete="email" value={email} onInput={(e) => setEmail((e.target as HTMLInputElement).value)} />
          </div>
          {state === 'too-many' && <div class="error">Too many tries. Wait a few minutes and try again.</div>}
          {state === 'error' && <div class="error">Something went wrong. Try again in a moment.</div>}
          <button class="b" disabled={state === 'busy' || !email}>{state === 'busy' ? 'Sending...' : 'Send me a link'}</button>
        </form>
      )}
    </div>
  );
}

export default function PlayerApp() {
  const on = playerBackendOn();
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState<string | null>(null);
  const [me, setMe] = useState<MyRecord | null>(null);
  const [stats, setStats] = useState<MyStats | null>(null);
  const [board, setBoard] = useState<BoardRow[]>([]);
  const [period, setPeriod] = useState<Period>('all');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const since = period === '90' ? daysAgo(90) : null;

  useEffect(() => {
    if (!on) { setLoading(false); return; }
    (async () => {
      try {
        const s = await sessionInfo();
        setEmail(s?.email ?? null);
        if (s) setMe(await linkMe());
      } catch { setErr('Could not load your details. Try again in a moment.'); }
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (!me) return;
    (async () => {
      try {
        const [st, lb] = await Promise.all([myStats(since), leaderboard(since)]);
        setStats(st);
        setBoard(lb);
        setErr('');
      } catch { setErr('Could not load your stats. Try again in a moment.'); }
    })();
  }, [me?.id, period, me?.show_stats]);

  if (!on) return <div class="play"><h1>Your stats</h1><div class="note">Player stats are not switched on yet.</div></div>;
  if (loading) return <div class="play"><p class="muted">Loading...</p></div>;
  if (!email) return <div class="play"><h1>Your stats</h1><SignIn /></div>;

  if (!me) {
    return (
      <div class="play">
        <h1>Your stats</h1>
        <div class="card">
          <h2>We could not find you</h2>
          <p>You are signed in as <strong>{email}</strong>, but that email is not on a player record. Ask a host at your next session to add it.</p>
          <button class="b small ghost" onClick={() => playerSignOut().then(() => location.reload())}>Sign out</button>
        </div>
        {err && <div class="error">{err}</div>}
      </div>
    );
  }

  const g = stats?.games;
  const a = stats?.attendance;
  const onBoard = me.show_stats && (!me.is_junior || me.guardian_ok);

  return (
    <div class="play">
      <div class="spread">
        <div><h1>Hi {firstName(me.name)}</h1><span class="muted">Your numbers from club play nights</span></div>
        <button class="b small ghost" onClick={() => playerSignOut().then(() => location.reload())}>Sign out</button>
      </div>
      {err && <div class="error">{err}</div>}

      <div class="seg" role="tablist" style="margin:1rem 0">
        <button class={period === 'all' ? 'on' : ''} role="tab" aria-selected={period === 'all'} onClick={() => setPeriod('all')}>All time</button>
        <button class={period === '90' ? 'on' : ''} role="tab" aria-selected={period === '90'} onClick={() => setPeriod('90')}>Last 90 days</button>
      </div>

      <h2>Your play</h2>
      {g && g.games > 0 ? (
        <div class="grid2">
          <div class="card"><div class="muted">Games</div><strong style="font-size:1.8rem">{g.games}</strong></div>
          <div class="card"><div class="muted">Won</div><strong style="font-size:1.8rem">{g.won}</strong> <span class="muted">({pct(g.won, g.games)})</span></div>
          <div class="card"><div class="muted">Points for / against</div><strong style="font-size:1.4rem">{g.points_for} / {g.points_against}</strong></div>
          <div class="card"><div class="muted">Points difference</div><strong style="font-size:1.8rem">{signed(g.points_for - g.points_against)}</strong></div>
        </div>
      ) : (
        <div class="card"><p class="muted" style="margin:0">No scored games yet in this period. They appear after a host saves the night.</p></div>
      )}

      {a && (
        <div class="card">
          <h3>Your attendance</h3>
          <p style="margin:0">Came to <strong>{a.attended}</strong> {a.attended === 1 ? 'night' : 'nights'}.
            {a.cancelled > 0 && <> Told the club in advance <strong>{a.cancelled}</strong> {a.cancelled === 1 ? 'time' : 'times'}.</>}
            {a.no_shows > 0 && <> Did not make it without letting us know <strong>{a.no_shows}</strong> {a.no_shows === 1 ? 'time' : 'times'}.</>}
          </p>
          <p class="muted small" style="margin:.5rem 0 0">Only you and the club's hosts can see this.</p>
        </div>
      )}

      {stats && stats.partners.length > 0 && (
        <div class="card">
          <h3>Most played with</h3>
          {stats.partners.map((p) => <div class="spread" key={p.name} style="padding:.25rem 0"><span>{p.name}</span><span class="muted">{p.games} games, {p.won} won</span></div>)}
        </div>
      )}

      {stats && stats.recent.length > 0 && (
        <div class="card" style="overflow-x:auto">
          <h3>Recent nights</h3>
          <table>
            <thead><tr><th class="l">Date</th><th class="l">Night</th><th>Games</th><th>Won</th></tr></thead>
            <tbody>{stats.recent.map((r) => <tr key={r.date + r.name}><td class="l">{r.date}</td><td class="l">{r.name}</td><td>{r.games}</td><td>{r.won}</td></tr>)}</tbody>
          </table>
        </div>
      )}

      <h2>Club leaderboard</h2>
      {!me.show_stats ? (
        <div class="note">You have switched your stats off, so you are not on the leaderboard and it is hidden for you. Switch them back on below to see it.</div>
      ) : board.length === 0 ? (
        <div class="card"><p class="muted" style="margin:0">Nobody has played enough games yet. Players need at least 6 scored games to appear.</p></div>
      ) : (
        <div class="card" style="overflow-x:auto">
          <table>
            <thead><tr><th>#</th><th class="l">Player</th><th>Games</th><th>Win %</th><th>+/-</th></tr></thead>
            <tbody>
              {board.map((r, i) => (
                <tr key={r.name} style={r.is_me ? 'background:var(--sand)' : ''}>
                  <td>{i + 1}</td><td class="l"><strong>{r.name}</strong>{r.is_me ? ' (you)' : ''}</td><td>{r.games}</td><td>{Math.round(r.win_pct)}%</td><td>{signed(r.diff)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p class="muted small">Ranked on win percentage, then points difference. Only players with at least 6 scored games appear. The leaderboard shows games only, never attendance.</p>

      <h2>Your privacy</h2>
      <div class="card">
        <label class="check">
          <input type="checkbox" checked={me.show_stats} disabled={busy} onChange={async (e) => {
            const show = (e.target as HTMLInputElement).checked;
            setBusy(true);
            try { await setVisibility(show); setMe({ ...me, show_stats: show }); } catch { setErr('Could not save that. Try again.'); }
            setBusy(false);
          }} />
          <span><strong>Show me on the club leaderboard</strong><br />
            <span class="muted small">Untick to leave it. Hosts still record who played so the night runs properly, but other players will not see your name or numbers, and you will not see the board.</span></span>
        </label>
        {me.is_junior && (
          <p class="small" style="margin:.7rem 0 0">
            Under 18s appear on the leaderboard only when a parent or guardian has agreed. {me.guardian_ok ? 'That has been agreed for you.' : 'That has not been recorded yet, so you are not shown to other players. Ask a host if a parent would like to say yes.'}
            {onBoard ? '' : ''}
          </p>
        )}
        <p class="small muted" style="margin:.7rem 0 0">
          We keep your name, email, which nights you came to, and the scores of your games. Only hosts and you can see your attendance. To see everything we hold, or have it deleted, email <a href="mailto:hello@firstandlastpickleball.co.uk">hello@firstandlastpickleball.co.uk</a>. More in our <a href="/privacy">privacy notice</a>.
        </p>
      </div>
    </div>
  );
}
