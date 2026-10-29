// Where play sessions are kept. Always saved on this device first (so the hall's patchy wifi
// never loses a night), and copied to Supabase when someone is signed in.
import type { Session, Gender } from './engine.ts';
import { supabase } from './auth.ts';

export interface Member {
  id: string;
  name: string;
  gender: Gender;
  active: boolean;
}

export interface PastRating {
  memberId: string;
  level: number;
  note: string;
  at: string;
  sessionName: string;
  sessionId: string;
}

export interface SessionSummary {
  id: string;
  name: string;
  date: string;
  ended: boolean;
  updatedAt: string;
}

const K = {
  index: 'fl-play:index',
  session: (id: string) => `fl-play:s:${id}`,
  members: 'fl-play:members',
  ratings: 'fl-play:ratings',
  dirty: 'fl-play:dirty',
};

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or blocked: carry on, cloud copy still works */
  }
}

// ---------- on this device ----------

export const local = {
  list(): SessionSummary[] {
    return read<SessionSummary[]>(K.index, []).sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt.localeCompare(a.updatedAt));
  },
  load(id: string): Session | null {
    return read<Session | null>(K.session(id), null);
  },
  save(s: Session) {
    write(K.session(s.id), s);
    const idx = read<SessionSummary[]>(K.index, []).filter((x) => x.id !== s.id);
    idx.push({ id: s.id, name: s.name, date: s.date, ended: s.ended, updatedAt: new Date().toISOString() });
    write(K.index, idx);
  },
  remove(id: string) {
    try {
      localStorage.removeItem(K.session(id));
    } catch {
      /* ignore */
    }
    write(K.index, read<SessionSummary[]>(K.index, []).filter((x) => x.id !== id));
  },
  members(): Member[] {
    return read<Member[]>(K.members, []);
  },
  ensureMember(name: string, gender: Gender): Member {
    const all = read<Member[]>(K.members, []);
    const found = all.find((m) => m.name.toLowerCase() === name.trim().toLowerCase());
    if (found) return found;
    const m: Member = { id: crypto.randomUUID(), name: name.trim(), gender, active: true };
    write(K.members, [...all, m]);
    return m;
  },
  ratings(): PastRating[] {
    return read<PastRating[]>(K.ratings, []);
  },
  saveRatings(rows: PastRating[]) {
    const all = read<PastRating[]>(K.ratings, []).filter((r) => !rows.some((n) => n.memberId === r.memberId && n.sessionId === r.sessionId));
    write(K.ratings, [...all, ...rows]);
  },
};

// ---------- backup and restore (this device) ----------

const LAST = 'fl-play:last';
export function rememberOpen(id: string | null, tab: string) {
  if (id) write(LAST, { id, tab, at: Date.now() });
  else {
    try { localStorage.removeItem(LAST); } catch { /* ignore */ }
  }
}
export function lastOpen(): { id: string; tab: string; at: number } | null {
  return read<{ id: string; tab: string; at: number } | null>(LAST, null);
}

export interface Backup {
  app: 'fl-play';
  version: 1;
  exportedAt: string;
  sessions: Session[];
  members: Member[];
  ratings: PastRating[];
}

export function exportAll(): Backup {
  const sessions = local.list().map((x) => local.load(x.id)).filter((x): x is Session => !!x);
  return { app: 'fl-play', version: 1, exportedAt: new Date().toISOString(), sessions, members: local.members(), ratings: local.ratings() };
}

/** Merge a backup into this device. Sessions with the same id are replaced; nothing is deleted.
 *  Members are matched by name so ratings from another phone join up with the right people. */
export function importAll(raw: string): { sessions: number; members: number; ratings: number } {
  const b = JSON.parse(raw) as Backup;
  if (b.app !== 'fl-play' || !Array.isArray(b.sessions)) throw new Error('That file is not a play night backup.');
  const have = local.members();
  const byName = new Map(have.map((m) => [m.name.toLowerCase(), m]));
  const merged = [...have];
  const idMap = new Map<string, string>();
  for (const m of b.members ?? []) {
    if (!m?.name) continue;
    const existing = byName.get(m.name.toLowerCase());
    if (existing) idMap.set(m.id, existing.id);
    else {
      merged.push(m);
      byName.set(m.name.toLowerCase(), m);
      idMap.set(m.id, m.id);
    }
  }
  write(K.members, merged);
  const remap = (id: string | undefined) => (id ? idMap.get(id) ?? id : id);
  let sessions = 0;
  for (const s of b.sessions) {
    if (!s || !s.id || !Array.isArray(s.players) || !Array.isArray(s.rounds)) continue;
    local.save({ ...s, players: s.players.map((p) => ({ ...p, memberId: remap(p.memberId) })) });
    sessions++;
  }
  const ratings = local.ratings();
  const seen = new Set(ratings.map((r) => `${r.memberId}|${r.sessionId}`));
  const add = (b.ratings ?? [])
    .map((r) => ({ ...r, memberId: remap(r.memberId) as string }))
    .filter((r) => r.memberId && !seen.has(`${r.memberId}|${r.sessionId}`));
  write(K.ratings, [...ratings, ...add]);
  return { sessions, members: (b.members ?? []).length, ratings: add.length };
}

// ---------- in the cloud ----------

export const cloudEnabled = () => supabase !== null;

export const cloud = {
  async list(): Promise<SessionSummary[]> {
    if (!supabase) return [];
    const { data, error } = await supabase
      .from('play_sessions')
      .select('id,name,session_date,ended,updated_at')
      .order('session_date', { ascending: false })
      .order('updated_at', { ascending: false })
      .limit(60);
    if (error) throw error;
    return (data ?? []).map((r) => ({ id: r.id, name: r.name, date: r.session_date, ended: r.ended, updatedAt: r.updated_at }));
  },
  async load(id: string): Promise<Session | null> {
    if (!supabase) return null;
    const { data, error } = await supabase.from('play_sessions').select('state').eq('id', id).maybeSingle();
    if (error) throw error;
    return (data?.state as Session) ?? null;
  },
  async save(s: Session) {
    if (!supabase) return;
    const { error } = await supabase.from('play_sessions').upsert({
      id: s.id,
      name: s.name,
      session_date: s.date,
      ended: s.ended,
      state: s,
      updated_at: new Date().toISOString(),
    });
    if (error) throw error;
  },
  async remove(id: string) {
    if (!supabase) return;
    const { error } = await supabase.from('play_sessions').delete().eq('id', id);
    if (error) throw error;
  },
  async members(): Promise<Member[]> {
    if (!supabase) return [];
    const { data, error } = await supabase.from('play_members').select('id,name,gender,active').eq('active', true).order('name');
    if (error) throw error;
    return (data ?? []) as Member[];
  },
  async ensureMember(name: string, gender: Gender): Promise<Member> {
    if (!supabase) throw new Error('Not signed in');
    const clean = name.trim();
    const { data: found, error: e1 } = await supabase.from('play_members').select('id,name,gender,active').ilike('name', clean).maybeSingle();
    if (e1) throw e1;
    if (found) return found as Member;
    const { data, error } = await supabase.from('play_members').insert({ name: clean, gender }).select('id,name,gender,active').single();
    if (error) throw error;
    return data as Member;
  },
  /** Most recent rating for each member. */
  async ratings(): Promise<PastRating[]> {
    if (!supabase) return [];
    const { data, error } = await supabase
      .from('play_ratings')
      .select('member_id,level,note,rated_at,session_id,play_sessions(name)')
      .order('rated_at', { ascending: false })
      .limit(2000);
    if (error) throw error;
    return (data ?? []).map((r: any) => ({
      memberId: r.member_id,
      level: r.level,
      note: r.note,
      at: r.rated_at,
      sessionName: r.play_sessions?.name ?? '',
      sessionId: r.session_id ?? '',
    }));
  },
  async saveRatings(rows: { memberId: string; sessionId: string; level: number; note: string }[]) {
    if (!supabase || rows.length === 0) return;
    const ids = rows.map((r) => r.memberId);
    // replace any earlier rating from this same session, so re-saving does not duplicate
    const { error: e1 } = await supabase.from('play_ratings').delete().eq('session_id', rows[0].sessionId).in('member_id', ids);
    if (e1) throw e1;
    const { error } = await supabase.from('play_ratings').insert(
      rows.map((r) => ({ member_id: r.memberId, session_id: r.sessionId, level: r.level, note: r.note })),
    );
    if (error) throw error;
  },
};

/** Latest rating per member id, newest first wins. */
export function latestByMember(rows: PastRating[]): Record<string, PastRating> {
  const out: Record<string, PastRating> = {};
  for (const r of rows.slice().sort((a, b) => b.at.localeCompare(a.at))) if (!out[r.memberId]) out[r.memberId] = r;
  return out;
}

// ---------- keeping the two in step ----------

export function markDirty(id: string) {
  const d = read<string[]>(K.dirty, []);
  if (!d.includes(id)) write(K.dirty, [...d, id]);
}
export function clearDirty(id: string) {
  write(K.dirty, read<string[]>(K.dirty, []).filter((x) => x !== id));
}
export function dirtyIds(): string[] {
  return read<string[]>(K.dirty, []);
}
