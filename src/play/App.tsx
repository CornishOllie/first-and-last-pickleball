import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import './play.css';
import {
  LEVELS, activePlayers, addPlayer, autoPair, canRedraw, leaderboard, newSession, nextRound, parseNames, playerById,
  playerName, redrawLast, removePlayer, setRating, setScore, summaryText, unpairedPlayers, updatePlayer, pairsAreValid,
  addExpected, checkIn, checkInAll, expectedPlayers, notComing, candidatesFromText, hasPlayer,
} from './engine.ts';
import type { Format, Gender, Match, Round, Session } from './engine.ts';
import { cloud, cloudEnabled, local, latestByMember, markDirty, clearDirty, dirtyIds, exportAll, importAll, rememberOpen, lastOpen } from './backend.ts';
import type { Member, PastRating, SessionSummary } from './backend.ts';
import { currentHost, sendLoginLink, signOut } from './auth.ts';
import { idleTimer, startGame, pause, resume, remaining, tick, skip, formatClock } from './timer.ts';
import type { TimerState } from './timer.ts';
import { beep, keepAwake, unlock } from './audio.ts';
import { fetchSpondEvents, listCode, SpondError, spondMessage, whenText } from './spondApi.ts';
import type { SpondEvent } from './spondApi.ts';
import { checkCode, isUnlocked, lock, touch, unlock as openDoor } from './gate.ts';

type Host = { email: string } | 'not-host' | null | 'loading';
type Tab = 'play' | 'players' | 'table' | 'finish';
type Sync = 'device' | 'saving' | 'synced' | 'offline';

const todayISO = () => new Date().toISOString().slice(0, 10);
const weekday = () => new Date().toLocaleDateString('en-GB', { weekday: 'long' });

// ---------- sign in ----------

function Login({ notHost }: { notHost: boolean }) {
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <div class="card">
      <h2>Host sign-in</h2>
      <p class="muted">This tool is for club hosts only. Enter your email and we will send you a sign-in link. No password needed.</p>
      {notHost && (
        <div class="error">
          You are signed in, but this account is not on the host list. Ask the committee to add you.
          <div style="margin-top:.5rem">
            <button class="b small ghost" onClick={() => signOut().then(() => location.reload())}>Sign out</button>
          </div>
        </div>
      )}
      {sent ? (
        <div class="note">Check your email for the sign-in link, then open it on this device.</div>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const err = await sendLoginLink(email);
            setBusy(false);
            if (err) setMsg(err);
            else setSent(true);
          }}
        >
          <div class="field">
            <label for="em">Email</label>
            <input id="em" type="email" required autoComplete="email" value={email} onInput={(e) => setEmail((e.target as HTMLInputElement).value)} />
          </div>
          {msg && <div class="error">{msg}</div>}
          <button class="b" disabled={busy || !email}>{busy ? 'Sending...' : 'Send sign-in link'}</button>
        </form>
      )}
    </div>
  );
}

// ---------- the door ----------

function DoorCode({ onOpen }: { onOpen: () => void }) {
  const [code, setCode] = useState('');
  const [bad, setBad] = useState(false);
  return (
    <div class="card">
      <h2>Host tools</h2>
      <p class="muted">Enter the code to carry on.</p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (await checkCode(code)) { openDoor(); onOpen(); } else { setBad(true); setCode(''); }
        }}
      >
        <div class="field">
          <label for="code">Code</label>
          <input id="code" type="password" inputMode="numeric" autoComplete="off" value={code} onInput={(e) => { setBad(false); setCode((e.target as HTMLInputElement).value); }} />
        </div>
        {bad && <div class="error">That is not the right code.</div>}
        <button class="b" disabled={!code}>Open</button>
      </form>
    </div>
  );
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
const backupName = () => `play-night-backup-${new Date().toISOString().slice(0, 10)}.json`;

function BackupCard({ onRestored }: { onRestored: () => void }) {
  const [msg, setMsg] = useState('');
  return (
    <div class="card soft">
      <h3>Backup</h3>
      <p class="muted">Sessions, players and ratings are kept on this phone only. Download a backup now and then, and after each night if you rated people. You can restore it here or on another phone.</p>
      <div class="row">
        <button class="b small" onClick={() => download(backupName(), JSON.stringify(exportAll()))}>Download backup</button>
        <label class="b small ghost" style="cursor:pointer;margin:0">
          Restore from file
          <input type="file" accept="application/json,.json" style="display:none" onChange={async (e) => {
            const f = (e.target as HTMLInputElement).files?.[0];
            if (!f) return;
            try {
              const r = importAll(await f.text());
              setMsg(`Restored ${r.sessions} sessions and ${r.ratings} new ratings.`);
              onRestored();
            } catch (err) { setMsg((err as Error).message); }
            (e.target as HTMLInputElement).value = '';
          }} />
        </label>
      </div>
      {msg && <p class="muted" style="margin:.6rem 0 0">{msg}</p>}
    </div>
  );
}

// ---------- home ----------

const FORMATS: { id: Format; title: string; text: string }[] = [
  { id: 'mixer', title: 'Mixer', text: 'Partners and opponents change every round. Best for a social night.' },
  { id: 'fixed', title: 'Fixed partners', text: 'Partners are drawn once, then pairs play different pairs each round.' },
  { id: 'ladder', title: 'Ladder (up and down the river)', text: 'Winners move up a court, losers move down. Partners change each round.' },
];

function Home({ sessions, onOpen, onCreate, onDelete, onRestored }: {
  sessions: SessionSummary[];
  onRestored: () => void;
  onOpen: (id: string) => void;
  onCreate: (s: Session) => void;
  onDelete: (id: string) => void;
}) {
  const [name, setName] = useState(`${weekday()} night`);
  const [date, setDate] = useState(todayISO());
  const [format, setFormat] = useState<Format>('mixer');
  const [courts, setCourts] = useState(4);
  const [game, setGame] = useState(12);
  const [change, setChange] = useState(3);
  const [mixed, setMixed] = useState(false);
  const [balance, setBalance] = useState(false);
  return (
    <div>
      <h2>New session</h2>
      <form
        class="card"
        onSubmit={(e) => {
          e.preventDefault();
          const s = newSession(crypto.randomUUID(), name.trim() || 'Play night', date);
          s.settings = { format, courts, gameMinutes: game, changeoverMinutes: change, preferMixed: mixed, balanceLevels: balance };
          onCreate(s);
        }}
      >
        <div class="grid2">
          <div class="field"><label for="n">Name</label><input id="n" type="text" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} /></div>
          <div class="field"><label for="d">Date</label><input id="d" type="date" value={date} onInput={(e) => setDate((e.target as HTMLInputElement).value)} /></div>
        </div>
        <div class="field">
          <label>Format</label>
          <div class="formats">
            {FORMATS.map((f) => (
              <div class={`fmt ${format === f.id ? 'on' : ''}`} onClick={() => setFormat(f.id)}>
                <strong>{f.title}</strong>
                <span class="muted">{f.text}</span>
              </div>
            ))}
          </div>
        </div>
        <div class="grid2">
          <div class="field"><label for="c">Courts</label><input id="c" type="number" min={1} max={12} value={courts} onInput={(e) => setCourts(Math.max(1, Number((e.target as HTMLInputElement).value) || 1))} /></div>
          <div class="field"><label for="g">Game (minutes)</label><input id="g" type="number" min={1} max={60} value={game} onInput={(e) => setGame(Math.max(1, Number((e.target as HTMLInputElement).value) || 1))} /></div>
          <div class="field"><label for="ch">Changeover (minutes)</label><input id="ch" type="number" min={0} max={20} value={change} onInput={(e) => setChange(Math.max(0, Number((e.target as HTMLInputElement).value) || 0))} /></div>
        </div>
        <label class="check"><input type="checkbox" checked={mixed} onChange={(e) => setMixed((e.target as HTMLInputElement).checked)} /><span>Pair a man with a woman where possible<br /><span class="muted">Set each player's M or F on the Players tab.</span></span></label>
        <label class="check"><input type="checkbox" checked={balance} onChange={(e) => setBalance((e.target as HTMLInputElement).checked)} /><span>Balance teams by level<br /><span class="muted">Uses the level you set for each player, so matches are even.</span></span></label>
        <button class="b">Start session</button>
      </form>

      <h2>Earlier sessions</h2>
      {sessions.length === 0 && <p class="muted">Nothing yet.</p>}
      {sessions.map((s) => (
        <div class="card spread" key={s.id}>
          <div><strong>{s.name}</strong><br /><span class="muted">{s.date}{s.ended ? ' - finished' : ' - in progress'}</span></div>
          <div class="row">
            <button class="b small" onClick={() => onOpen(s.id)}>Open</button>
            <button class="b small danger" onClick={() => confirm(`Delete "${s.name}"? This can not be undone.`) && onDelete(s.id)}>Delete</button>
          </div>
        </div>
      ))}
      <BackupCard onRestored={onRestored} />
    </div>
  );
}

// ---------- timer ----------

function useTimer(session: Session) {
  const key = `fl-play:timer:${session.id}`;
  const [state, setState] = useState<TimerState>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as TimerState) : idleTimer();
    } catch {
      return idleTimer();
    }
  });
  const [now, setNow] = useState(Date.now());
  const ref = useRef(state);
  const warned = useRef(false);
  const settings = { gameMinutes: session.settings.gameMinutes, changeoverMinutes: session.settings.changeoverMinutes };
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const put = (next: TimerState) => {
    ref.current = next;
    setState(next);
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* ignore */ }
  };

  useEffect(() => {
    const back = () => {
      if (document.visibilityState === 'visible' && ref.current.running) void keepAwake(true);
    };
    document.addEventListener('visibilitychange', back);
    return () => document.removeEventListener('visibilitychange', back);
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      const cur = ref.current;
      const r = tick(cur, settingsRef.current, t);
      if (r.event === 'game-over') beep(3, 660);
      if (r.event === 'change-over') { beep(2, 990); void keepAwake(false); }
      if (r.state.phase !== cur.phase) warned.current = false;
      if (!warned.current && r.state.running && r.state.phase === 'game' && remaining(r.state, t) <= 60_000 && settingsRef.current.gameMinutes > 2) {
        warned.current = true;
        beep(1, 1200);
      }
      if (r.state !== cur) put(r.state);
    }, 250);
    return () => clearInterval(id);
  }, []);

  return {
    state, now, left: remaining(state, now),
    start: () => { unlock(); void keepAwake(true); warned.current = false; put(startGame(settingsRef.current, Date.now())); },
    pause: () => put(pause(ref.current, Date.now())),
    resume: () => { unlock(); put(resume(ref.current, Date.now())); },
    skip: () => put(skip(ref.current, settingsRef.current, Date.now())),
    reset: () => { void keepAwake(false); put(idleTimer()); },
  };
}

type TimerApi = ReturnType<typeof useTimer>;

const phaseLabel = (t: TimerApi) =>
  t.state.phase === 'game' ? 'Game' : t.state.phase === 'change' ? 'Changeover' : t.state.phase === 'ready' ? 'Ready for the next round' : 'Timer';

function TimerPanel({ t, onPresent }: { t: TimerApi; onPresent: () => void }) {
  const { state } = t;
  const cls = `timer ${state.phase === 'change' ? 'change' : state.phase === 'ready' ? 'ready' : ''} ${state.phase === 'game' && t.left <= 60_000 && t.left > 0 ? 'low' : ''}`;
  return (
    <div class={cls}>
      <div class="phase">{phaseLabel(t)}</div>
      <div class="clock">{state.phase === 'idle' || state.phase === 'ready' ? '--:--' : formatClock(t.left)}</div>
      <div class="row" style="justify-content:center">
        {(state.phase === 'idle' || state.phase === 'ready') && <button class="b" onClick={t.start}>Start game</button>}
        {(state.phase === 'game' || state.phase === 'change') && state.running && <button class="b" onClick={t.pause}>Pause</button>}
        {(state.phase === 'game' || state.phase === 'change') && !state.running && <button class="b" onClick={t.resume}>Resume</button>}
        {(state.phase === 'game' || state.phase === 'change') && <button class="b ghost" onClick={t.skip}>Skip</button>}
        {state.phase !== 'idle' && <button class="b ghost" onClick={t.reset}>Reset</button>}
        <button class="b ghost" onClick={onPresent}>Big screen</button>
      </div>
    </div>
  );
}

function Present({ session, round, t, onClose }: { session: Session; round: Round | undefined; t: TimerApi; onClose: () => void }) {
  const names = (ids: string[]) => ids.map((id) => playerName(session, id)).join(' & ');
  return (
    <div class="present">
      <button class="b ghost x" onClick={onClose}>Close</button>
      <div class="ph">{round ? `Round ${round.number}` : 'Round'} &middot; {phaseLabel(t)}</div>
      <div class={`big ${t.state.phase === 'change' ? 'change' : t.state.phase === 'ready' ? 'ready' : ''}`}>
        {t.state.phase === 'idle' || t.state.phase === 'ready' ? (t.state.phase === 'ready' ? 'Next!' : '--:--') : formatClock(t.left)}
      </div>
      {round && (
        <div class="courts">
          {round.matches.map((m) => (
            <div class="pc"><b>Court {m.court}</b><br />{names(m.a)}<br /><span class="muted">v</span><br />{names(m.b)}</div>
          ))}
          {round.sitting.length > 0 && <div class="pc"><b>Sitting out</b><br />{names(round.sitting)}</div>}
        </div>
      )}
    </div>
  );
}

// ---------- play tab ----------

function ScoreRow({ session, round, m, onScore }: { session: Session; round: Round; m: Match; onScore: (court: number, a: number | null, b: number | null) => void }) {
  const names = (ids: string[]) => ids.map((id) => playerName(session, id)).join(' & ');
  const num = (v: string): number | null => (v === '' ? null : Math.max(0, Math.floor(Number(v))));
  const aWin = m.scoreA !== null && m.scoreB !== null && m.scoreA > m.scoreB;
  const bWin = m.scoreA !== null && m.scoreB !== null && m.scoreB > m.scoreA;
  return (
    <div class="match">
      <div class="court"><small>Court</small>{m.court}</div>
      <div>
        <div class={`side ${aWin ? 'win' : ''}`}>
          <div class="names">{names(m.a)}</div>
          <input type="number" inputMode="numeric" min={0} aria-label={`Score for ${names(m.a)}`} value={m.scoreA ?? ''}
            onInput={(e) => onScore(m.court, num((e.target as HTMLInputElement).value), m.scoreB)} />
        </div>
        <div class="vs">versus</div>
        <div class={`side ${bWin ? 'win' : ''}`}>
          <div class="names">{names(m.b)}</div>
          <input type="number" inputMode="numeric" min={0} aria-label={`Score for ${names(m.b)}`} value={m.scoreB ?? ''}
            onInput={(e) => onScore(m.court, m.scoreA, num((e.target as HTMLInputElement).value))} />
        </div>
      </div>
    </div>
  );
}

function RoundCard({ session, round, onScore, title }: { session: Session; round: Round; onScore: (rn: number, court: number, a: number | null, b: number | null) => void; title?: string }) {
  return (
    <div class="card">
      <h3>{title ?? `Round ${round.number}`}</h3>
      {round.matches.map((m) => <ScoreRow key={m.court} session={session} round={round} m={m} onScore={(c, a, b) => onScore(round.number, c, a, b)} />)}
      {round.sitting.length > 0 && (
        <p class="muted" style="margin:.7rem 0 0">Sitting out: {round.sitting.map((id) => playerName(session, id)).join(', ')}</p>
      )}
    </div>
  );
}

function PlayTab({ session, update, t, onPresent }: { session: Session; update: (f: (s: Session) => Session) => void; t: TimerApi; onPresent: () => void }) {
  const [error, setError] = useState('');
  const active = activePlayers(session);
  const last = session.rounds[session.rounds.length - 1];
  const fixed = session.settings.format === 'fixed';
  const pairs = pairsAreValid(session);
  const loose = unpairedPlayers(session);

  const draw = () => {
    setError('');
    try {
      const r = nextRound(session);
      update((s) => ({ ...s, rounds: [...s.rounds, r] }));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const redraw = () => {
    setError('');
    try {
      const r = redrawLast(session);
      update((s) => ({ ...s, rounds: [...s.rounds.slice(0, -1), r] }));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const onScore = (rn: number, court: number, a: number | null, b: number | null) => update((s) => setScore(s, rn, court, a, b));

  return (
    <div>
      <TimerPanel t={t} onPresent={onPresent} />

      {expectedPlayers(session).length > 0 && (
        <div class="card soft">
          <h3>Still to arrive</h3>
          <div class="chips">
            {expectedPlayers(session).map((p) => (
              <button class="chip" style="border:0;cursor:pointer;font-weight:600" onClick={() => update((s) => checkIn(s, p.id))}>{p.name} is here</button>
            ))}
          </div>
        </div>
      )}
      {active.length < 4 && <div class="note">You need at least four players here. Use the Players tab to bring in tonight's list.</div>}

      {fixed && (
        <div class="card soft">
          <h3>Pairs</h3>
          {pairs.length === 0 && <p class="muted">No pairs yet.</p>}
          <div class="chips">
            {pairs.map(([x, y]) => <span class="chip">{playerName(session, x)} &amp; {playerName(session, y)}</span>)}
          </div>
          {loose.length > 0 && <p class="muted" style="margin:.6rem 0 0">Without a partner: {loose.map((p) => p.name).join(', ')}</p>}
          <div class="row" style="margin-top:.7rem">
            <button class="b small" disabled={loose.length < 2} onClick={() => update((s) => ({ ...s, pairs: autoPair(s) }))}>Draw partners</button>
            <button class="b small ghost" disabled={pairs.length === 0} onClick={() => confirm('Break up all pairs and draw again?') && update((s) => ({ ...s, pairs: autoPair({ ...s, pairs: [] }) }))}>Redraw all pairs</button>
          </div>
        </div>
      )}

      <div class="row" style="margin:1rem 0">
        <button class="b" disabled={active.length < 4} onClick={draw}>{session.rounds.length === 0 ? 'Draw round 1' : `Draw round ${session.rounds.length + 1}`}</button>
        {canRedraw(session) && <button class="b ghost" onClick={redraw}>Redraw this round</button>}
      </div>
      {error && <div class="error">{error}</div>}

      {last && <RoundCard session={session} round={last} onScore={onScore} title={`Round ${last.number} (now)`} />}
      {session.rounds.length > 1 && (
        <details>
          <summary class="muted" style="cursor:pointer;margin:.6rem 0">Earlier rounds ({session.rounds.length - 1})</summary>
          {session.rounds.slice(0, -1).reverse().map((r) => <RoundCard key={r.number} session={session} round={r} onScore={onScore} />)}
        </details>
      )}
    </div>
  );
}

// ---------- players tab ----------

interface PreviewRow { name: string; original: string; gender: Gender; keep: boolean; note?: string }

function NameBox({ id, value, update }: { id: string; value: string; update: (f: (s: Session) => Session) => void }) {
  return (
    <input type="text" value={value} aria-label="Name" style="min-height:36px;padding:.2rem .5rem;font-weight:600;width:100%"
      onChange={(e) => update((s) => updatePlayer(s, id, { name: (e.target as HTMLInputElement).value.trim() || value }))} />
  );
}

function PlayersTab({ session, update, members, past }: {
  session: Session;
  update: (f: (s: Session) => Session) => void;
  members: Member[];
  past: Record<string, PastRating>;
}) {
  const [name, setName] = useState('');
  const [gender, setGender] = useState<Gender>('');
  const [bulk, setBulk] = useState('');
  const [preview, setPreview] = useState<PreviewRow[] | null>(null);
  const [events, setEvents] = useState<SpondEvent[] | null>(null);
  const [askCode, setAskCode] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [spondErr, setSpondErr] = useState('');
  const active = activePlayers(session);
  const expected = expectedPlayers(session);
  const gone = session.players.filter((p) => !p.active && !p.expected);
  const knownMember = (n: string) => members.find((m) => m.name.toLowerCase() === n.trim().toLowerCase());

  const incoming = (rows: PreviewRow[]) =>
    rows.filter((r) => r.keep && r.name.trim()).map((r) => {
      const m = knownMember(r.name);
      return { name: r.name.trim(), source: r.original, gender: (m?.gender || r.gender) as Gender, level: m ? past[m.id]?.level ?? 0 : 0, memberId: m?.id };
    });

  const getFromSpond = async (typed?: string) => {
    const useCode = typed ?? listCode.get();
    if (!useCode) { setAskCode(true); return; }
    setBusy(true);
    setSpondErr('');
    try {
      const found = await fetchSpondEvents(useCode);
      listCode.set(useCode);
      setAskCode(false);
      setCode('');
      setEvents(found);
    } catch (e) {
      const kind = e instanceof SpondError ? e.kind : 'spond';
      if (kind === 'bad-code') { listCode.clear(); setAskCode(true); }
      setSpondErr(spondMessage[kind]);
    }
    setBusy(false);
  };

  const useEvent = (ev: SpondEvent) => {
    setPreview([
      ...ev.accepted.map((n) => ({ name: n, original: n, gender: '' as Gender, keep: true })),
      ...ev.waiting.map((n) => ({ name: n, original: n, gender: '' as Gender, keep: false, note: 'waiting list' })),
    ]);
    setEvents(null);
  };

  const addWalkIn = (raw: string, g: Gender) => {
    const m = knownMember(raw);
    update((s) => addPlayer(s, raw, { gender: m?.gender || g, level: m ? past[m.id]?.level ?? 0 : 0, memberId: m?.id, walkIn: true }));
  };

  return (
    <div>
      <h2>Bring in tonight's list</h2>
      <div class="card">
        {!preview ? (
          <>
            {!events && (
              <>
                <p class="muted" style="margin-top:0">Gets the people who have said yes in Spond, so you do not have to type them. You can fix any name before they are added.</p>
                {askCode ? (
                  <form class="row" onSubmit={(e) => { e.preventDefault(); void getFromSpond(code); }}>
                    <input type="password" autoComplete="off" placeholder="List code" aria-label="List code" value={code} onInput={(e) => setCode((e.target as HTMLInputElement).value)} style="flex:1;min-width:8rem" />
                    <button class="b" disabled={busy || !code}>{busy ? 'Checking...' : 'Get list'}</button>
                  </form>
                ) : (
                  <button class="b" disabled={busy} onClick={() => void getFromSpond()}>{busy ? 'Getting the list...' : "Get tonight's list from Spond"}</button>
                )}
                {spondErr && <div class="error">{spondErr}</div>}
                <details style="margin-top:1rem">
                  <summary style="cursor:pointer;font-weight:600">Or paste a list</summary>
                  <div class="field" style="margin-top:.6rem">
                    <textarea placeholder={'One name per line. Headings, numbers and emoji are ignored.'} value={bulk} onInput={(e) => setBulk((e.target as HTMLTextAreaElement).value)} />
                  </div>
                  <button class="b small" disabled={!candidatesFromText(bulk).length} onClick={() => setPreview(candidatesFromText(bulk).map((c) => ({ name: c.name, original: c.name, gender: '' as Gender, keep: true })))}>
                    Preview {candidatesFromText(bulk).length ? `${candidatesFromText(bulk).length} names` : ''}
                  </button>
                </details>
              </>
            )}
            {events && (
              <>
                <p><strong>Which session?</strong></p>
                {events.length === 0 && <p class="muted">No sessions found in Spond for the next week.</p>}
                {events.map((ev) => (
                  <div class="spread" style="padding:.5rem 0;border-bottom:1px dashed var(--line)" key={ev.id}>
                    <div><strong>{ev.heading}</strong><br /><span class="muted">{whenText(ev.start)} - {ev.accepted.length} coming{ev.waiting.length ? `, ${ev.waiting.length} waiting` : ''}</span></div>
                    <button class="b small" onClick={() => useEvent(ev)}>Use this list</button>
                  </div>
                ))}
                <button class="b small ghost" style="margin-top:.7rem" onClick={() => setEvents(null)}>Back</button>
              </>
            )}
          </>
        ) : (
          <>
            <p><strong>Check the names</strong> <span class="muted">Untick anyone who should not be added. Edit a name to fix it.</span></p>
            <ul class="plist">
              {preview.map((r, i) => (
                <li key={i} style="grid-template-columns:auto 1fr auto">
                  <input type="checkbox" checked={r.keep} aria-label={`Include ${r.name}`} onChange={(e) => setPreview(preview.map((x, j) => (j === i ? { ...x, keep: (e.target as HTMLInputElement).checked } : x)))} />
                  <span style="display:flex;gap:.4rem;align-items:center">
                    <input type="text" value={r.name} aria-label="Name" style="min-height:36px;padding:.2rem .5rem;flex:1;min-width:0" onInput={(e) => setPreview(preview.map((x, j) => (j === i ? { ...x, name: (e.target as HTMLInputElement).value } : x)))} />
                    {r.note && <span class="chip">{r.note}</span>}
                    {knownMember(r.name) && <span class="chip">known</span>}
                    {(hasPlayer(session, r.name) || hasPlayer(session, r.original)) && <span class="chip">already added</span>}
                  </span>
                  <select aria-label={`Gender for ${r.name}`} value={r.gender} onChange={(e) => setPreview(preview.map((x, j) => (j === i ? { ...x, gender: (e.target as HTMLSelectElement).value as Gender } : x)))}>
                    <option value="">-</option><option value="M">M</option><option value="F">F</option>
                  </select>
                </li>
              ))}
            </ul>
            <div class="row" style="margin-top:.7rem">
              <button class="b small" onClick={() => { update((s) => addExpected(s, incoming(preview))); setPreview(null); setBulk(''); }}>
                Add {incoming(preview).length} as expected
              </button>
              <button class="b small ghost" onClick={() => { update((s) => checkInAll(addExpected(s, incoming(preview)))); setPreview(null); setBulk(''); }}>
                Add and mark all here
              </button>
              <button class="b small ghost" onClick={() => setPreview(null)}>Back</button>
            </div>
          </>
        )}
      </div>

      {expected.length > 0 && (
        <div>
          <div class="spread"><h2 style="margin-bottom:0">Still to arrive ({expected.length})</h2>
            <button class="b small" onClick={() => update((s) => checkInAll(s))}>Everyone is here</button></div>
          <p class="muted">Tap Here as people arrive. Late arrivals join from the next round. No-shows can just stay on this list, or be removed.</p>
          <ul class="plist card">
            {expected.map((p) => (
              <li key={p.id} style="grid-template-columns:1fr auto auto">
                <NameBox id={p.id} value={p.name} update={update} />
                <button class="b small" onClick={() => update((s) => checkIn(s, p.id))}>Here</button>
                <button class="b small danger" onClick={() => update((s) => notComing(s, p.id))}>Not coming</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <h2>Here tonight ({active.length})</h2>
      {active.length === 0 && <p class="muted">Nobody has arrived yet.</p>}
      <ul class="plist card">
        {active.map((p) => (
          <li key={p.id}>
            <span style="display:flex;gap:.4rem;align-items:center"><NameBox id={p.id} value={p.name} update={update} />{p.walkIn && <span class="chip" title="Not on Spond">walk-in</span>}</span>
            <select aria-label={`Gender for ${p.name}`} value={p.gender} onChange={(e) => update((s) => updatePlayer(s, p.id, { gender: (e.target as HTMLSelectElement).value as Gender }))}>
              <option value="">-</option><option value="M">M</option><option value="F">F</option>
            </select>
            <select aria-label={`Level for ${p.name}`} value={p.level} onChange={(e) => update((s) => updatePlayer(s, p.id, { level: Number((e.target as HTMLSelectElement).value) }))}>
              {LEVELS.map((l, i) => <option value={i}>{i === 0 ? 'Level?' : l}</option>)}
            </select>
            <button class="b small danger" onClick={() => update((s) => removePlayer(s, p.id))}>Left</button>
          </li>
        ))}
      </ul>
      <p class="muted">Changes apply from the next round. If scores are not in yet, use "Redraw this round" on the Play tab. "Left" is for someone going home early.</p>

      <h2>Not on Spond? Add a walk-in</h2>
      <form class="card row" onSubmit={(e) => { e.preventDefault(); if (name.trim()) { addWalkIn(name, gender); setName(''); } }}>
        <input type="text" list="members" placeholder="Name" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} style="flex:1;min-width:10rem" />
        <datalist id="members">{members.map((m) => <option value={m.name} />)}</datalist>
        <select value={gender} onChange={(e) => setGender((e.target as HTMLSelectElement).value as Gender)} aria-label="Gender">
          <option value="">M/F (optional)</option><option value="M">M</option><option value="F">F</option>
        </select>
        <button class="b" disabled={!name.trim()}>Add</button>
      </form>

      {gone.length > 0 && (
        <div>
          <h2>Left or removed</h2>
          <div class="chips">
            {gone.map((p) => <button class="chip" style="border:0;cursor:pointer" onClick={() => update((s) => addPlayer(s, p.name))}>{p.name} (bring back)</button>)}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- table tab ----------

function TableTab({ session }: { session: Session }) {
  const rows = leaderboard(session);
  return (
    <div>
      <h2>Table</h2>
      {rows.length === 0 ? <p class="muted">Scores will appear here.</p> : (
        <div class="card" style="overflow-x:auto">
          <table>
            <thead><tr><th>#</th><th class="l">Player</th><th>P</th><th>W</th><th>L</th><th>For</th><th>Agst</th><th>+/-</th><th>Sat</th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id}>
                  <td>{i + 1}</td><td class="l"><strong>{r.name}</strong></td><td>{r.played}</td><td>{r.won}</td><td>{r.lost}</td>
                  <td>{r.pointsFor}</td><td>{r.pointsAgainst}</td><td>{r.diff > 0 ? `+${r.diff}` : r.diff}</td><td>{r.sat}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p class="muted">Ranked on wins, then points difference, then points scored.</p>
    </div>
  );
}

// ---------- finish tab ----------

function FinishTab({ session, update, past, onEnd, cloudOn }: {
  session: Session;
  update: (f: (s: Session) => Session) => void;
  past: Record<string, PastRating>;
  onEnd: () => Promise<string | null>;
  cloudOn: boolean;
}) {
  const [msg, setMsg] = useState('');
  const [copied, setCopied] = useState(false);
  const rows = leaderboard(session);
  const people = session.players.filter((p) => p.active || rows.find((r) => r.id === p.id && r.played > 0));
  const text = summaryText(session);
  return (
    <div>
      <h2>Rate the players</h2>
      <p class="muted">Optional. Give each player a level and a note. These are kept for hosts and shown next time that player joins in. Nothing here is shared with players.</p>
      <div class="card">
        {people.map((p) => {
          const r = session.ratings[p.id];
          const prev = p.memberId ? past[p.memberId] : undefined;
          return (
            <div class="rate" key={p.id}>
              <div class="top">
                <strong>{p.name}</strong>
                <select aria-label={`Rating for ${p.name}`} value={r?.level ?? 0} onChange={(e) => update((s) => setRating(s, p.id, Number((e.target as HTMLSelectElement).value), s.ratings[p.id]?.note ?? ''))}>
                  {LEVELS.map((l, i) => <option value={i}>{l}</option>)}
                </select>
              </div>
              {prev && <span class="muted">Last time: {LEVELS[prev.level]} ({prev.at.slice(0, 10)}){prev.note ? ` - ${prev.note}` : ''}</span>}
              <input type="text" placeholder="Note (optional)" value={r?.note ?? ''} onInput={(e) => update((s) => setRating(s, p.id, s.ratings[p.id]?.level ?? 0, (e.target as HTMLInputElement).value))} />
            </div>
          );
        })}
      </div>

      <h2>Share the results</h2>
      <div class="card">
        <pre style="white-space:pre-wrap;margin:0 0 .7rem;font-family:inherit">{text}</pre>
        <button class="b small ghost" onClick={async () => { try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* ignore */ } }}>
          {copied ? 'Copied' : 'Copy to paste into Spond or WhatsApp'}
        </button>
      </div>

      <h2>Save</h2>
      <p class="muted">Saving finishes the night and keeps each rating against that player for next time. It stays on this phone, so download a backup too.</p>
      {msg && <div class={msg === 'Saved.' ? 'note' : 'error'}>{msg}</div>}
      {!cloudOn && <p><button class="b small ghost" onClick={() => download(backupName(), JSON.stringify(exportAll()))}>Download backup</button></p>}
      <button class="b" onClick={async () => { const e = await onEnd(); setMsg(e ?? 'Saved.'); }}>{session.ended ? 'Save again' : 'Save session'}</button>
    </div>
  );
}

// ---------- shell ----------

const syncText: Record<Sync, string> = {
  device: 'Saved on this device',
  saving: 'Saving...',
  synced: 'Saved and synced',
  offline: 'Offline. Saved here, will sync when back online',
};

function SessionScreen({ session, update, tab, setTab, members, past, pastRows, onEnd, cloudOn, presenting, setPresenting }: {
  session: Session;
  update: (f: (s: Session) => Session) => void;
  tab: Tab;
  setTab: (t: Tab) => void;
  members: Member[];
  past: Record<string, PastRating>;
  pastRows: PastRating[];
  onEnd: () => Promise<string | null>;
  cloudOn: boolean;
  presenting: boolean;
  setPresenting: (b: boolean) => void;
}) {
  const timer = useTimer(session);
  return (
    <>
      <div class="tabs" role="tablist">
        {(['play', 'players', 'table', 'finish'] as Tab[]).map((k) => (
          <button class={`tab ${tab === k ? 'on' : ''}`} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
            {k === 'play' ? 'Play' : k === 'players' ? `Players (${activePlayers(session).length})` : k === 'table' ? 'Table' : 'Finish'}
          </button>
        ))}
      </div>
      {tab === 'play' && <PlayTab session={session} update={update} t={timer} onPresent={() => setPresenting(true)} />}
      {tab === 'players' && <PlayersTab session={session} update={update} members={members} past={past} />}
      {tab === 'table' && <TableTab session={session} />}
      {tab === 'finish' && <FinishTab session={session} update={update} past={latestByMember(pastRows.filter((r) => r.sessionId !== session.id))} onEnd={onEnd} cloudOn={cloudOn} />}
      {presenting && <Present session={session} round={session.rounds[session.rounds.length - 1]} t={timer} onClose={() => setPresenting(false)} />}
    </>
  );
}

export default function App() {
  const cloudOn = cloudEnabled();
  const [host, setHost] = useState<Host>(cloudOn ? 'loading' : null);
  const [opened, setOpened] = useState(cloudOn || isUnlocked());
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [session, setSession] = useState<Session | null>(null);
  const [tab, setTab] = useState<Tab>('play');
  const [sync, setSync] = useState<Sync>('device');
  const [members, setMembers] = useState<Member[]>([]);
  const [pastRows, setPastRows] = useState<PastRating[]>([]);
  const past = useMemo(() => latestByMember(pastRows), [pastRows]);
  const [presenting, setPresenting] = useState(false);
  const [loadErr, setLoadErr] = useState('');
  const timerTimeout = useRef<number | undefined>(undefined);
  const first = useRef(true);

  const signedIn = cloudOn ? host !== 'loading' && host !== null && host !== 'not-host' : opened;

  useEffect(() => { if (cloudOn) currentHost().then(setHost); }, []);

  // Stay unlocked while the tool is in use. If it has been 12 hours since the last use, ask for the code again.
  useEffect(() => {
    if (cloudOn) return;
    const alive = () => { if (isUnlocked()) touch(); else setOpened(false); };
    const events = ['pointerdown', 'keydown', 'visibilitychange'];
    events.forEach((e) => window.addEventListener(e, alive));
    const id = setInterval(alive, 60_000);
    return () => { events.forEach((e) => window.removeEventListener(e, alive)); clearInterval(id); };
  }, []);

  const refreshLists = async () => {
    let list: SessionSummary[] = local.list();
    let mem: Member[] = local.members();
    let ratings: PastRating[] = local.ratings();
    if (cloudOn) {
      try {
        const [cl, cm, cr] = await Promise.all([cloud.list(), cloud.members(), cloud.ratings()]);
        const ids = new Set(cl.map((x) => x.id));
        list = [...cl, ...list.filter((x) => !ids.has(x.id))];
        mem = cm;
        ratings = [...cr, ...ratings];
      } catch (e) {
        setLoadErr('Could not reach the server. Showing what is saved on this device.');
      }
    }
    setSessions(list);
    setMembers(mem);
    setPastRows(ratings);
  };

  useEffect(() => {
    if (!signedIn) return;
    void refreshLists();
    // Pick up where the host left off (for example after switching to another app and back).
    const last = lastOpen();
    if (last && Date.now() - last.at < 12 * 60 * 60 * 1000 && local.load(last.id)) {
      void open(last.id).then(() => setTab((['play', 'players', 'table', 'finish'].includes(last.tab) ? last.tab : 'play') as Tab));
    }
  }, [signedIn]);

  useEffect(() => { if (signedIn) rememberOpen(session ? session.id : null, tab); }, [session?.id, tab, signedIn]);

  // push anything that failed to sync earlier
  const flush = async () => {
    if (!cloudOn) return;
    for (const id of dirtyIds()) {
      const s = local.load(id);
      if (!s) { clearDirty(id); continue; }
      try { await cloud.save(s); clearDirty(id); } catch { /* try again later */ }
    }
  };
  useEffect(() => {
    window.addEventListener('online', flush);
    return () => window.removeEventListener('online', flush);
  }, []);

  const update = (f: (s: Session) => Session) => setSession((cur) => (cur ? f(cur) : cur));

  // autosave: device straight away, cloud a moment later
  useEffect(() => {
    if (!session) return;
    if (first.current) { first.current = false; return; }
    local.save(session);
    if (!cloudOn) { setSync('device'); return; }
    setSync('saving');
    markDirty(session.id);
    window.clearTimeout(timerTimeout.current);
    timerTimeout.current = window.setTimeout(async () => {
      try {
        await cloud.save(session);
        clearDirty(session.id);
        setSync('synced');
      } catch {
        setSync('offline');
      }
    }, 1200);
  }, [session]);

  const open = async (id: string) => {
    let s: Session | null = local.load(id);
    if (cloudOn && !dirtyIds().includes(id)) {
      try { s = (await cloud.load(id)) ?? s; } catch { /* use device copy */ }
    }
    if (s) { first.current = true; setSession(s); setTab('play'); setSync(cloudOn ? 'synced' : 'device'); }
  };
  const create = (s: Session) => { first.current = false; local.save(s); setSession(s); setTab('play'); setSync('saving'); };
  const remove = async (id: string) => {
    local.remove(id);
    if (cloudOn) { try { await cloud.remove(id); } catch { /* ignore */ } }
    void refreshLists();
  };

    const endSession = async (): Promise<string | null> => {
    if (!session) return null;
    try {
      let s = session;
      const rated = s.players.filter((p) => s.ratings[p.id] && s.ratings[p.id].level > 0);
      // make sure every rated player is a saved member so the rating is remembered next time
      const rows: { memberId: string; sessionId: string; level: number; note: string }[] = [];
      for (const p of rated) {
        const m = cloudOn ? await cloud.ensureMember(p.name, p.gender) : local.ensureMember(p.name, p.gender);
        if (!p.memberId) s = { ...s, players: s.players.map((x) => (x.id === p.id ? { ...x, memberId: m.id } : x)) };
        rows.push({ memberId: m.id, sessionId: s.id, level: s.ratings[p.id].level, note: s.ratings[p.id].note });
      }
      s = { ...s, ended: true };
      setSession(s);
      local.save(s);
      local.saveRatings(rows.map((r) => ({ memberId: r.memberId, level: r.level, note: r.note, at: new Date().toISOString(), sessionName: s.name, sessionId: s.id })));
      if (cloudOn) { await cloud.save(s); await cloud.saveRatings(rows); clearDirty(s.id); setSync('synced'); }
      void refreshLists();
      return null;
    } catch (e) {
      return `Could not save: ${(e as Error).message}`;
    }
  };

  if (host === 'loading') return <div class="play"><p class="muted">Loading...</p></div>;
  if (!cloudOn && !opened) return <div class="play"><h1>Play night</h1><DoorCode onOpen={() => setOpened(true)} /></div>;
  if (cloudOn && !signedIn) return <div class="play"><h1>Play night</h1><Login notHost={host === 'not-host'} /></div>;

  return (
    <div class="play">
      <div class="spread">
        <div>
          <h1>{session ? session.name : 'Play night'}</h1>
          <span class="muted">{session ? `${session.date} - ${syncText[sync]}` : cloudOn ? 'Signed in' : 'Kept on this phone'}</span>
        </div>
        <div class="row">
          {session && <button class="b small ghost" onClick={() => { setSession(null); first.current = true; void refreshLists(); }}>All sessions</button>}
          {cloudOn && <button class="b small ghost" onClick={() => signOut().then(() => location.reload())}>Sign out</button>}
          {!cloudOn && <button class="b small ghost" onClick={() => { lock(); setOpened(false); }}>Lock</button>}
        </div>
      </div>
      {loadErr && <div class="error">{loadErr}</div>}

      {!session && <Home sessions={sessions} onOpen={open} onCreate={create} onDelete={remove} onRestored={() => void refreshLists()} />}

      {session && (
        <SessionScreen
          session={session} update={update} tab={tab} setTab={setTab} members={members} past={past} pastRows={pastRows}
          onEnd={endSession} cloudOn={cloudOn} presenting={presenting} setPresenting={setPresenting}
        />
      )}
    </div>
  );
}
