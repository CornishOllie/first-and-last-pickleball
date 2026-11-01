// Pairing, scoring and rating logic for club play sessions.
// Pure functions only: no DOM, no network. Everything takes a session and returns new data,
// so it can be tested on its own and reused by the app.

export type Gender = 'M' | 'F' | '';
export type Format = 'mixer' | 'fixed' | 'ladder';

export interface Player {
  id: string;
  name: string;
  gender: Gender;
  /** 0 = not rated. 1 Beginner, 2 Improver, 3 Intermediate, 4 High Intermediate, 5 Advanced. */
  level: number;
  active: boolean;
  /** Round number (1-based) this player joined at. */
  joinedRound: number;
  /** Link to a saved club member, when picked from the member list. */
  memberId?: string;
  /** On the Spond list but not checked in yet. Not drawn into rounds until they arrive. */
  expected?: boolean;
  /** Turned up without being on the Spond list. */
  walkIn?: boolean;
  /** The name as it came from Spond, kept when the host corrects the spelling, so fetching the list again does not add a duplicate. */
  source?: string;
  /** Told the host they are not coming. Kept (not deleted) so attendance can be recorded and a refetch does not add them back. */
  cancelled?: boolean;
  /** Confirmed by a host as a no-show: expected, never arrived, never said. */
  noShow?: boolean;
}

export interface Match {
  court: number;
  a: string[];
  b: string[];
  scoreA: number | null;
  scoreB: number | null;
}

export interface Round {
  number: number;
  matches: Match[];
  sitting: string[];
}

export interface Settings {
  format: Format;
  courts: number;
  gameMinutes: number;
  changeoverMinutes: number;
  /** Prefer a man and a woman as partners where genders are known. */
  preferMixed: boolean;
  /** Try to make the two sides of each match evenly matched, using levels. */
  balanceLevels: boolean;
}

export interface Rating {
  level: number;
  note: string;
}

export interface Session {
  id: string;
  name: string;
  /** YYYY-MM-DD */
  date: string;
  settings: Settings;
  players: Player[];
  rounds: Round[];
  /** Fixed partner pairs (player ids), used by the 'fixed' format. */
  pairs: [string, string][];
  ended: boolean;
  ratings: Record<string, Rating>;
}

export type Rng = () => number;

export const LEVELS = ['Not rated', 'Beginner', 'Improver', 'Intermediate', 'High Intermediate', 'Advanced'];

export function defaultSettings(): Settings {
  return {
    format: 'mixer',
    courts: 4,
    gameMinutes: 12,
    changeoverMinutes: 3,
    preferMixed: false,
    balanceLevels: false,
  };
}

export function newSession(id: string, name: string, date: string): Session {
  return {
    id,
    name,
    date,
    settings: defaultSettings(),
    players: [],
    rounds: [],
    pairs: [],
    ended: false,
    ratings: {},
  };
}

// ---------- small helpers ----------

/** Seeded generator so tests are repeatable. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], rng: Rng): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const pairKey = (x: string, y: string) => (x < y ? `${x}|${y}` : `${y}|${x}`);

export function activePlayers(s: Session): Player[] {
  return s.players.filter((p) => p.active);
}

export function playerById(s: Session, id: string): Player | undefined {
  return s.players.find((p) => p.id === id);
}

export function playerName(s: Session, id: string): string {
  return playerById(s, id)?.name ?? '(removed)';
}

// ---------- history ----------

export interface History {
  partners: Map<string, number>;
  opponents: Map<string, number>;
  /** Games played per player id. */
  games: Map<string, number>;
  /** Number of times sat out. */
  sits: Map<string, number>;
  /** Last round number the player sat out (0 = never). */
  lastSat: Map<string, number>;
  /** Games played per fixed pair key. */
  pairGames: Map<string, number>;
  /** Times a pair has faced another pair, keyed "pairKey#pairKey". */
  pairOpponents: Map<string, number>;
}

const bump = (m: Map<string, number>, k: string, by = 1) => m.set(k, (m.get(k) ?? 0) + by);

export function buildHistory(s: Session): History {
  const h: History = {
    partners: new Map(),
    opponents: new Map(),
    games: new Map(),
    sits: new Map(),
    lastSat: new Map(),
    pairGames: new Map(),
    pairOpponents: new Map(),
  };
  for (const r of s.rounds) {
    for (const m of r.matches) {
      for (const side of [m.a, m.b]) {
        for (const id of side) bump(h.games, id);
        if (side.length === 2) bump(h.partners, pairKey(side[0], side[1]));
      }
      for (const x of m.a) for (const y of m.b) bump(h.opponents, pairKey(x, y));
      if (m.a.length === 2 && m.b.length === 2) {
        const ka = pairKey(m.a[0], m.a[1]);
        const kb = pairKey(m.b[0], m.b[1]);
        bump(h.pairGames, ka);
        bump(h.pairGames, kb);
        bump(h.pairOpponents, ka < kb ? `${ka}#${kb}` : `${kb}#${ka}`);
      }
    }
    for (const id of r.sitting) {
      bump(h.sits, id);
      h.lastSat.set(id, r.number);
    }
  }
  return h;
}

// ---------- mixer: partners and opponents rotate ----------

const levelOf = (p: Player | undefined) => (p && p.level > 0 ? p.level : 3);

interface CostCtx {
  s: Session;
  h: History;
}

function matchCost(ctx: CostCtx, ids: string[]): number {
  const [a1, a2, b1, b2] = ids;
  const { s, h } = ctx;
  let cost = 0;
  for (const [x, y] of [
    [a1, a2],
    [b1, b2],
  ]) {
    const n = h.partners.get(pairKey(x, y)) ?? 0;
    cost += 120 * n * n + (n > 0 ? 60 : 0); // repeat partners hurt most
    if (s.settings.preferMixed) {
      const gx = playerById(s, x)?.gender;
      const gy = playerById(s, y)?.gender;
      if (gx && gy && gx === gy) cost += 400;
    }
  }
  for (const x of [a1, a2]) {
    for (const y of [b1, b2]) {
      const n = h.opponents.get(pairKey(x, y)) ?? 0;
      cost += 14 * n * n;
    }
  }
  if (s.settings.balanceLevels) {
    const la = levelOf(playerById(s, a1)) + levelOf(playerById(s, a2));
    const lb = levelOf(playerById(s, b1)) + levelOf(playerById(s, b2));
    cost += 40 * Math.abs(la - lb);
  }
  return cost;
}

function arrangementCost(ctx: CostCtx, order: string[]): number {
  let c = 0;
  for (let i = 0; i < order.length; i += 4) c += matchCost(ctx, order.slice(i, i + 4));
  return c;
}

/** Best arrangement of the given players into matches of four, by random restarts and swap search. */
function arrange(ctx: CostCtx, ids: string[], rng: Rng, restarts = 40): string[] {
  if (ids.length === 0) return [];
  let best = ids.slice();
  let bestCost = Infinity;
  for (let r = 0; r < restarts; r++) {
    const order = shuffle(ids, rng);
    let cost = arrangementCost(ctx, order);
    let improved = true;
    let passes = 0;
    while (improved && passes < 25) {
      improved = false;
      passes++;
      for (let i = 0; i < order.length - 1; i++) {
        for (let j = i + 1; j < order.length; j++) {
          if (Math.floor(i / 4) === Math.floor(j / 4) && i % 4 < 2 === j % 4 < 2) continue; // same pair: no change
          [order[i], order[j]] = [order[j], order[i]];
          const c = arrangementCost(ctx, order);
          if (c < cost - 1e-9) {
            cost = c;
            improved = true;
          } else {
            [order[i], order[j]] = [order[j], order[i]];
          }
        }
      }
    }
    if (cost < bestCost) {
      bestCost = cost;
      best = order.slice();
      if (cost === 0) break;
    }
  }
  return best;
}

/** How many players can play this round, given the courts. */
export function playingCapacity(activeCount: number, courts: number): number {
  return 4 * Math.min(courts, Math.floor(activeCount / 4));
}

/** Pick who sits out: those who have played most, then who sat out longest ago. */
function chooseSitters(s: Session, h: History, ids: string[], sitCount: number, rng: Rng): string[] {
  if (sitCount <= 0) return [];
  const ranked = shuffle(ids, rng).sort((x, y) => {
    const gx = h.games.get(x) ?? 0;
    const gy = h.games.get(y) ?? 0;
    if (gx !== gy) return gy - gx; // most games first: they sit
    return (h.lastSat.get(x) ?? 0) - (h.lastSat.get(y) ?? 0); // sat longest ago first
  });
  return ranked.slice(0, sitCount);
}

function mixerRound(s: Session, rng: Rng): Round {
  const h = buildHistory(s);
  const ids = activePlayers(s).map((p) => p.id);
  const cap = playingCapacity(ids.length, s.settings.courts);
  const sitters = chooseSitters(s, h, ids, ids.length - cap, rng);
  const playing = ids.filter((id) => !sitters.includes(id));
  const order = arrange({ s, h }, playing, rng);
  const matches: Match[] = [];
  for (let i = 0; i < order.length; i += 4) {
    matches.push({
      court: i / 4 + 1,
      a: [order[i], order[i + 1]],
      b: [order[i + 2], order[i + 3]],
      scoreA: null,
      scoreB: null,
    });
  }
  return { number: s.rounds.length + 1, matches, sitting: sitters };
}

// ---------- fixed partners ----------

export function pairsAreValid(s: Session): [string, string][] {
  const act = new Set(activePlayers(s).map((p) => p.id));
  return s.pairs.filter(([x, y]) => act.has(x) && act.has(y));
}

export function unpairedPlayers(s: Session): Player[] {
  const paired = new Set(pairsAreValid(s).flat());
  return activePlayers(s).filter((p) => !paired.has(p.id));
}

/** Draw partners at random for everyone not yet paired. With preferMixed, men are paired with women first. */
export function autoPair(s: Session, rng: Rng = Math.random): [string, string][] {
  const keep = pairsAreValid(s);
  const free = unpairedPlayers(s);
  const out = keep.slice();
  let pool = shuffle(free, rng);
  if (s.settings.preferMixed) {
    const men = pool.filter((p) => p.gender === 'M');
    const women = pool.filter((p) => p.gender === 'F');
    const n = Math.min(men.length, women.length);
    for (let i = 0; i < n; i++) out.push([men[i].id, women[i].id]);
    pool = [...men.slice(n), ...women.slice(n), ...pool.filter((p) => p.gender !== 'M' && p.gender !== 'F')];
  } else if (s.settings.balanceLevels) {
    // strongest with weakest
    pool = pool.sort((x, y) => levelOf(y) - levelOf(x));
    while (pool.length > 1) {
      const top = pool.shift()!;
      const low = pool.pop()!;
      out.push([top.id, low.id]);
    }
    return out;
  }
  while (pool.length > 1) out.push([pool.shift()!.id, pool.shift()!.id]);
  return out;
}

function fixedRound(s: Session, rng: Rng): Round {
  const h = buildHistory(s);
  const pairs = pairsAreValid(s);
  const capTeams = Math.min(2 * s.settings.courts, Math.floor(pairs.length / 2) * 2);
  const keyOf = (p: [string, string]) => pairKey(p[0], p[1]);
  const ranked = shuffle(pairs, rng).sort((p, q) => {
    const gp = h.pairGames.get(keyOf(p)) ?? 0;
    const gq = h.pairGames.get(keyOf(q)) ?? 0;
    if (gp !== gq) return gp - gq; // fewest games play
    const lp = Math.max(h.lastSat.get(p[0]) ?? 0, h.lastSat.get(p[1]) ?? 0);
    const lq = Math.max(h.lastSat.get(q[0]) ?? 0, h.lastSat.get(q[1]) ?? 0);
    return lq - lp; // sat most recently plays first
  });
  const playingPairs = ranked.slice(0, capTeams);
  const sittingPairs = ranked.slice(capTeams);

  const teamCost = (order: [string, string][]) => {
    let c = 0;
    for (let i = 0; i < order.length; i += 2) {
      const ka = keyOf(order[i]);
      const kb = keyOf(order[i + 1]);
      const n = h.pairOpponents.get(ka < kb ? `${ka}#${kb}` : `${kb}#${ka}`) ?? 0;
      c += 100 * n * n;
      if (s.settings.balanceLevels) {
        const la = levelOf(playerById(s, order[i][0])) + levelOf(playerById(s, order[i][1]));
        const lb = levelOf(playerById(s, order[i + 1][0])) + levelOf(playerById(s, order[i + 1][1]));
        c += 40 * Math.abs(la - lb);
      }
    }
    return c;
  };
  let best = playingPairs.slice();
  let bestCost = Infinity;
  for (let r = 0; r < 40; r++) {
    const order = shuffle(playingPairs, rng);
    let cost = teamCost(order);
    let improved = true;
    while (improved) {
      improved = false;
      for (let i = 0; i < order.length - 1; i++) {
        for (let j = i + 1; j < order.length; j++) {
          if (Math.floor(i / 2) === Math.floor(j / 2)) continue;
          [order[i], order[j]] = [order[j], order[i]];
          const c = teamCost(order);
          if (c < cost - 1e-9) {
            cost = c;
            improved = true;
          } else [order[i], order[j]] = [order[j], order[i]];
        }
      }
    }
    if (cost < bestCost) {
      bestCost = cost;
      best = order.slice();
      if (cost === 0) break;
    }
  }
  const matches: Match[] = [];
  for (let i = 0; i < best.length; i += 2) {
    matches.push({ court: i / 2 + 1, a: [...best[i]], b: [...best[i + 1]], scoreA: null, scoreB: null });
  }
  const sitting = [...sittingPairs.flat(), ...unpairedPlayers(s).map((p) => p.id)];
  return { number: s.rounds.length + 1, matches, sitting };
}

// ---------- ladder: winners move up, losers move down ----------

export class RoundNotReady extends Error {}

function winnersLosers(m: Match): { w: string[]; l: string[] } {
  if (m.scoreA === null || m.scoreB === null) throw new RoundNotReady('Enter every score from the last round first.');
  if (m.scoreA === m.scoreB) throw new RoundNotReady(`Court ${m.court} is a draw. Fix the score so there is a winner.`);
  return m.scoreA > m.scoreB ? { w: m.a, l: m.b } : { w: m.b, l: m.a };
}

/** Ranking used to form courts: first four are court 1, next four court 2, and so on. */
export function ladderRanking(s: Session, rng: Rng): string[] {
  const act = new Set(activePlayers(s).map((p) => p.id));
  const h = buildHistory(s);
  const last = s.rounds[s.rounds.length - 1];

  if (!last) {
    const pool = activePlayers(s);
    const anyLevel = pool.some((p) => p.level > 0);
    return shuffle(pool, rng)
      .sort((x, y) => (anyLevel ? levelOf(y) - levelOf(x) : 0))
      .map((p) => p.id);
  }

  const n = last.matches.length;
  const results = last.matches.map(winnersLosers);
  const groups: string[][] = [];
  for (let c = 0; c < n; c++) {
    if (n === 1) groups.push([...results[0].w, ...results[0].l]);
    else if (c === 0) groups.push([...results[0].w, ...results[1].w]);
    else if (c === n - 1) groups.push([...results[n - 1].l, ...results[n - 2].l]);
    else groups.push([...results[c + 1].w, ...results[c - 1].l]);
  }
  const clean = (g: string[]) => g.filter((id) => act.has(id));
  const upper = groups.slice(0, n - 1).map(clean);
  const bottom = clean(groups[n - 1]);

  const placed = new Set([...upper.flat(), ...bottom]);
  const newcomers = [...act].filter((id) => !placed.has(id));
  // The bottom court is the revolving door: whoever has played least gets the places.
  const pool = shuffle([...bottom, ...newcomers], rng).sort((x, y) => (h.games.get(x) ?? 0) - (h.games.get(y) ?? 0));
  return [...upper.flat(), ...pool];
}

function ladderRound(s: Session, rng: Rng): Round {
  const h = buildHistory(s);
  const ranking = ladderRanking(s, rng);
  const cap = playingCapacity(ranking.length, s.settings.courts);
  const playing = ranking.slice(0, cap);
  const sitting = ranking.slice(cap);
  const matches: Match[] = [];
  for (let c = 0; c < playing.length / 4; c++) {
    const four = playing.slice(4 * c, 4 * c + 4);
    // choose the best of the three ways to split four into two pairs
    const splits = [
      [four[0], four[1], four[2], four[3]],
      [four[0], four[2], four[1], four[3]],
      [four[0], four[3], four[1], four[2]],
    ];
    let best = splits[0];
    let bestCost = Infinity;
    for (const sp of splits) {
      const cost = matchCost({ s, h }, sp) + rng() * 0.01;
      if (cost < bestCost) {
        bestCost = cost;
        best = sp;
      }
    }
    matches.push({ court: c + 1, a: [best[0], best[1]], b: [best[2], best[3]], scoreA: null, scoreB: null });
  }
  return { number: s.rounds.length + 1, matches, sitting };
}

// ---------- public: next round ----------

export function nextRound(s: Session, rng: Rng = Math.random): Round {
  if (activePlayers(s).length < 4) throw new Error('You need at least four players to make a round.');
  switch (s.settings.format) {
    case 'fixed':
      if (pairsAreValid(s).length < 2) throw new Error('You need at least two pairs. Use "Draw partners" first.');
      return fixedRound(s, rng);
    case 'ladder':
      return ladderRound(s, rng);
    default:
      return mixerRound(s, rng);
  }
}

/** True when the latest round has no scores yet, so it is safe to redraw it. */
export function canRedraw(s: Session): boolean {
  const last = s.rounds[s.rounds.length - 1];
  return !!last && last.matches.every((m) => m.scoreA === null && m.scoreB === null);
}

/** Throw away the latest unscored round and draw it again (for example after a late arrival or a drop-out). */
export function redrawLast(s: Session, rng: Rng = Math.random): Round {
  if (!canRedraw(s)) throw new Error('Scores have been entered for this round, so it can not be redrawn.');
  const trimmed: Session = { ...s, rounds: s.rounds.slice(0, -1) };
  return nextRound(trimmed, rng);
}

// ---------- roster changes ----------

let counter = 0;
export const newId = () => `p${Date.now().toString(36)}${(counter++).toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

export function addPlayer(
  s: Session,
  name: string,
  extra: Partial<Pick<Player, 'gender' | 'level' | 'memberId' | 'walkIn'>> = {},
): Session {
  const clean = name.trim();
  if (!clean) return s;
  const existing = s.players.find((p) => p.name.toLowerCase() === clean.toLowerCase());
  if (existing) {
    if (existing.active) return s;
    // Welcome back: reactivate rather than add a duplicate.
    return { ...s, players: s.players.map((p) => (p === existing ? { ...p, active: true, expected: false, cancelled: false, noShow: false } : p)) };
  }
  const p: Player = {
    id: newId(),
    name: clean,
    gender: extra.gender ?? '',
    level: extra.level ?? 0,
    active: true,
    joinedRound: s.rounds.length + 1,
    memberId: extra.memberId,
    walkIn: extra.walkIn || undefined,
  };
  return { ...s, players: [...s.players, p] };
}

export interface Incoming {
  name: string;
  /** The name as Spond has it, if the host corrected the spelling. */
  source?: string;
  gender?: Gender;
  level?: number;
  memberId?: string;
}

/** Add people from the Spond list as expected: they are not drawn until checked in. Names already here are left alone. */
export function addExpected(s: Session, people: Incoming[]): Session {
  let out = s;
  for (const person of people) {
    const clean = person.name.trim();
    if (!clean) continue;
    if (hasPlayer(out, clean) || (person.source && hasPlayer(out, person.source))) continue;
    out = {
      ...out,
      players: [
        ...out.players,
        {
          id: newId(),
          name: clean,
          gender: person.gender ?? '',
          level: person.level ?? 0,
          active: false,
          expected: true,
          joinedRound: out.rounds.length + 1,
          memberId: person.memberId,
          source: (person.source ?? clean).trim(),
        },
      ],
    };
  }
  return out;
}

/** Is this person already in the session, under their Spond name or a corrected one? */
export function hasPlayer(s: Session, name: string): boolean {
  const n = name.trim().toLowerCase();
  return s.players.some((p) => p.name.toLowerCase() === n || p.source?.toLowerCase() === n);
}

export const expectedPlayers = (s: Session): Player[] => s.players.filter((p) => p.expected && !p.active && !p.cancelled && !p.noShow);
export const cancelledPlayers = (s: Session): Player[] => s.players.filter((p) => p.cancelled && !p.active);
export const noShowPlayers = (s: Session): Player[] => s.players.filter((p) => p.noShow && !p.active);
/** People who left the session after joining it (not cancelled, not no-shows). */
export const leftPlayers = (s: Session): Player[] => s.players.filter((p) => !p.active && !p.expected && !p.cancelled && !p.noShow);

/** Someone on the list has arrived. They join from the next round. */
export function checkIn(s: Session, id: string): Session {
  return {
    ...s,
    players: s.players.map((p) => (p.id === id ? { ...p, active: true, expected: false, joinedRound: s.rounds.length + 1 } : p)),
  };
}

export function checkInAll(s: Session): Session {
  return expectedPlayers(s).reduce((acc, p) => checkIn(acc, p.id), s);
}

/** Someone on the list has said they are not coming. They stay on record as cancelled, never drawn. */
export function notComing(s: Session, id: string): Session {
  return { ...s, players: s.players.map((p) => (p.id === id && p.expected && !p.active ? { ...p, expected: false, cancelled: true, noShow: false } : p)) };
}

/** A host confirms someone expected never turned up and never said. Only done at the end of a night. */
export function markNoShow(s: Session, id: string): Session {
  return { ...s, players: s.players.map((p) => (p.id === id && !p.active && (p.expected || p.cancelled) ? { ...p, expected: false, cancelled: false, noShow: true } : p)) };
}

/** Put someone back on the 'still to arrive' list (a mistake, or they changed their mind). */
export function reinstate(s: Session, id: string): Session {
  return { ...s, players: s.players.map((p) => (p.id === id && !p.active && (p.cancelled || p.noShow) ? { ...p, cancelled: false, noShow: false, expected: true } : p)) };
}

// ---------- recording the night ----------

export type AttendanceStatus = 'attended' | 'walk_in' | 'no_show' | 'cancelled';
export interface FactPlayer { key: string; name: string; gender: Gender; member_id?: string; status: AttendanceStatus }
export interface FactGame { round: number; court: number; a: [string, string]; b: [string, string]; score_a: number; score_b: number }

/** What to record about a night: who turned up, who did not, and every scored game.
 *  Someone still on the 'expected' list is not recorded either way until a host decides, so a no-show is never guessed. */
export function factsFromSession(s: Session): { players: FactPlayer[]; games: FactGame[] } {
  const present = new Set<string>();
  for (const r of s.rounds) {
    for (const id of r.sitting) present.add(id);
    for (const m of r.matches) for (const id of [...m.a, ...m.b]) present.add(id);
  }
  const players: FactPlayer[] = [];
  for (const p of s.players) {
    let status: AttendanceStatus | null = null;
    if (p.active || present.has(p.id)) status = p.walkIn ? 'walk_in' : 'attended';
    else if (p.cancelled) status = 'cancelled';
    else if (p.noShow) status = 'no_show';
    if (status) players.push({ key: p.id, name: p.name, gender: p.gender, member_id: p.memberId, status });
  }
  const games: FactGame[] = [];
  for (const r of s.rounds) {
    for (const m of r.matches) {
      if (m.scoreA === null || m.scoreB === null || m.a.length !== 2 || m.b.length !== 2) continue;
      games.push({ round: r.number, court: m.court, a: [m.a[0], m.a[1]], b: [m.b[0], m.b[1]], score_a: m.scoreA, score_b: m.scoreB });
    }
  }
  return { players, games };
}

const SPOND_HEADINGS = /^(accepted|attending|going|yes|confirmed|coming|declined|not attending|not going|no|unanswered|no response|not responded|waiting list|waitlist|maybe|invited|unconfirmed|responses?)\b[\s:(\d)]*$/i;
const SPOND_YES = /^(accepted|attending|going|yes|confirmed|coming)\b/i;

/** Pull player names out of text copied from a Spond event page, a spreadsheet or a typed list.
 *  If the text has headings (Accepted, Declined, Unanswered...), only the accepted section is used. */
export function parseSpondList(text: string): string[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const hasHeadings = lines.some((l) => SPOND_HEADINGS.test(l));
  let inYes = !hasHeadings;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of lines) {
    if (SPOND_HEADINGS.test(raw)) {
      inYes = SPOND_YES.test(raw);
      continue;
    }
    if (!inYes) continue;
    // table row such as "Ann Smith<tab>Accepted": keep only accepted rows
    const cols = raw.split('\t').map((c) => c.trim()).filter(Boolean);
    let line = cols[0] ?? '';
    if (cols.length > 1) {
      const status = cols.slice(1).find((c) => SPOND_HEADINGS.test(c));
      if (status && !SPOND_YES.test(status)) continue;
    }
    line = line
      .replace(/^\s*(?:[-*\u2022]|\d+[.)])\s*/, '') // bullets, numbering
      .replace(/\s*\(\d+\)\s*$/, '') // trailing count
      .replace(/\p{Extended_Pictographic}/gu, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!line) continue;
    if (/@|^\d[\d\s:/.-]*$|^(show|see|view) (more|all)|^(guests?|message|messages|add|edit|share|remind)$/i.test(line)) continue;
    // a line with several names separated by commas or semicolons
    for (const piece of line.split(/\s*[;,]\s*/)) {
      const name = piece.trim();
      if (name && !seen.has(name.toLowerCase())) {
        seen.add(name.toLowerCase());
        out.push(name);
      }
    }
  }
  return out;
}

export function removePlayer(s: Session, id: string): Session {
  return { ...s, players: s.players.map((p) => (p.id === id ? { ...p, active: false } : p)) };
}

export function updatePlayer(s: Session, id: string, patch: Partial<Pick<Player, 'name' | 'gender' | 'level'>>): Session {
  return { ...s, players: s.players.map((p) => (p.id === id ? { ...p, ...patch } : p)) };
}

/** Add several names at once, one per line or comma separated. Strips bullets and numbering. */
export function parseNames(text: string): string[] {
  return text
    .split(/[\n,;]+/)
    .map((x) => x.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
    .filter(Boolean);
}

// ---------- people coming from Spond ----------

export interface Candidate {
  name: string;
  /** yes = accepted, waiting = on the waiting list, unknown = from a plain list with no answers. */
  status: 'yes' | 'waiting' | 'unknown';
}

/** Candidates from pasted text: only accepted people if it has headings, otherwise everyone listed. */
export function candidatesFromText(text: string): Candidate[] {
  const hasHeadings = text.split(/\r?\n/).some((l) => SPOND_HEADINGS.test(l.trim()));
  return parseSpondList(text).map((name) => ({ name, status: hasHeadings ? 'yes' : 'unknown' }));
}

/** Lines such as "Ann Smith, ann@example.com", a tab-separated paste, or just "Ann Smith". Anything with an email-like part keeps it. */
export function parseMemberLines(text: string): { name: string; email: string }[] {
  const out: { name: string; email: string }[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^\s*(?:[-*\u2022]|\d+[.)])\s*/, '').trim();
    if (!line) continue;
    const m = line.match(/[^\s,;\t<>()"]+@[^\s,;\t<>()"]+\.[^\s,;\t<>()"]+/);
    const email = m ? m[0].toLowerCase() : '';
    const name = line.replace(m ? m[0] : '', '').replace(/[<>()"]/g, ' ').replace(/[,;\t]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, email });
  }
  return out;
}

// ---------- scoring ----------

export function setScore(s: Session, roundNumber: number, court: number, scoreA: number | null, scoreB: number | null): Session {
  return {
    ...s,
    rounds: s.rounds.map((r) =>
      r.number !== roundNumber
        ? r
        : { ...r, matches: r.matches.map((m) => (m.court === court ? { ...m, scoreA, scoreB } : m)) },
    ),
  };
}

export interface Standing {
  id: string;
  name: string;
  played: number;
  won: number;
  lost: number;
  drawn: number;
  pointsFor: number;
  pointsAgainst: number;
  diff: number;
  sat: number;
}

export function leaderboard(s: Session): Standing[] {
  const map = new Map<string, Standing>();
  const get = (id: string): Standing => {
    let st = map.get(id);
    if (!st) {
      st = { id, name: playerName(s, id), played: 0, won: 0, lost: 0, drawn: 0, pointsFor: 0, pointsAgainst: 0, diff: 0, sat: 0 };
      map.set(id, st);
    }
    return st;
  };
  for (const p of s.players) get(p.id);
  for (const r of s.rounds) {
    for (const id of r.sitting) get(id).sat++;
    for (const m of r.matches) {
      if (m.scoreA === null || m.scoreB === null) continue;
      const sides: [string[], number, number][] = [
        [m.a, m.scoreA, m.scoreB],
        [m.b, m.scoreB, m.scoreA],
      ];
      for (const [ids, f, a] of sides) {
        for (const id of ids) {
          const st = get(id);
          st.played++;
          st.pointsFor += f;
          st.pointsAgainst += a;
          if (f > a) st.won++;
          else if (f < a) st.lost++;
          else st.drawn++;
        }
      }
    }
  }
  const rows = [...map.values()].filter((st) => st.played > 0 || s.players.find((p) => p.id === st.id)?.active);
  for (const st of rows) st.diff = st.pointsFor - st.pointsAgainst;
  return rows.sort(
    (x, y) =>
      y.won - x.won ||
      y.diff - x.diff ||
      y.pointsFor - x.pointsFor ||
      x.played - y.played ||
      x.name.localeCompare(y.name),
  );
}

// ---------- ratings ----------

export function setRating(s: Session, playerId: string, level: number, note = ''): Session {
  const ratings = { ...s.ratings };
  if (level <= 0 && !note.trim()) delete ratings[playerId];
  else ratings[playerId] = { level, note };
  return { ...s, ratings };
}

/** Plain text summary of the night, ready to post to the group. */
export function summaryText(s: Session): string {
  const rows = leaderboard(s).filter((r) => r.played > 0);
  const lines = [`${s.name} - ${s.date}`, `${s.rounds.length} round${s.rounds.length === 1 ? '' : 's'}, ${activePlayers(s).length} players`, ''];
  rows.slice(0, 10).forEach((r, i) => {
    lines.push(`${i + 1}. ${r.name}: ${r.won} won, ${r.lost} lost, ${r.diff >= 0 ? '+' : ''}${r.diff}`);
  });
  return lines.join('\n');
}
