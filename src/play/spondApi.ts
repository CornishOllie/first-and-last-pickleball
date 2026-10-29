// Fetches the club's Spond sign-up lists through our own private endpoint (/api/spond-lists).
// The endpoint holds the Spond sign-in; this side only needs the list code.
import { OPEN_FOR_MS } from './gate.ts';

export interface SpondEvent {
  id: string;
  heading: string;
  group: string;
  start: string | null;
  accepted: string[];
  waiting: string[];
}

export type SpondErrorKind = 'bad-code' | 'slow-down' | 'not-set-up' | 'spond' | 'network';

export class SpondError extends Error {
  kind: SpondErrorKind;
  constructor(kind: SpondErrorKind) {
    super(kind);
    this.kind = kind;
  }
}

export const spondMessage: Record<SpondErrorKind, string> = {
  'bad-code': 'That list code is not right.',
  'slow-down': 'Too many wrong tries. Wait ten minutes, or paste the list instead.',
  'not-set-up': 'Spond lists are not switched on yet. Paste the list instead.',
  spond: 'Could not get the list from Spond. Try again, or paste the list instead.',
  network: 'No connection. Try again, or paste the list instead.',
};

const KEY = 'fl-play:listcode';

export const listCode = {
  get(now = Date.now()): string | null {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const v = JSON.parse(raw) as { code: string; at: number };
      return v.code && now - v.at < OPEN_FOR_MS ? v.code : null;
    } catch {
      return null;
    }
  },
  set(code: string) {
    try { localStorage.setItem(KEY, JSON.stringify({ code, at: Date.now() })); } catch { /* ignore */ }
  },
  clear() {
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  },
};

export async function fetchSpondEvents(code: string, fetchFn: typeof fetch = fetch): Promise<SpondEvent[]> {
  let res: Response;
  try {
    res = await fetchFn('/api/spond-lists', { headers: { 'x-play-code': code }, cache: 'no-store' });
  } catch {
    throw new SpondError('network');
  }
  if (res.status === 401) throw new SpondError('bad-code');
  if (res.status === 429) throw new SpondError('slow-down');
  if (res.status === 503) throw new SpondError('not-set-up');
  if (!res.ok) throw new SpondError('spond');
  try {
    const body = (await res.json()) as { events?: SpondEvent[] };
    if (!Array.isArray(body.events)) throw new Error('shape');
    return body.events;
  } catch {
    throw new SpondError('spond');
  }
}

export function whenText(start: string | null): string {
  if (!start) return '';
  const d = new Date(start);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
