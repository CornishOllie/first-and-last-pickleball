// The door: five taps on the site footer, then a code. A latch, not a lock. The code is in the page,
// so it only keeps casual visitors out. That is fine because everything stays on the host's own phone.
const CODE_HASH = 'a7d4c0c5aa2b0fa25a8bb0114fed012979386fb85ddcc106457821198b6b70b4';
const KEY = 'fl-play:unlocked';
/** Stay unlocked this long after last use. */
export const OPEN_FOR_MS = 12 * 60 * 60 * 1000;

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function checkCode(code: string): Promise<boolean> {
  try {
    return (await sha256(`fl-play:${code.trim()}`)) === CODE_HASH;
  } catch {
    return false;
  }
}

export function unlock() {
  try { localStorage.setItem(KEY, String(Date.now())); } catch { /* ignore */ }
}

export function lock() {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem('fl-play:listcode');
  } catch { /* ignore */ }
}

export function isUnlocked(now = Date.now()): boolean {
  try {
    const t = Number(localStorage.getItem(KEY));
    return t > 0 && now - t < OPEN_FOR_MS;
  } catch {
    return false;
  }
}

/** Call on activity. Slides the expiry forward, at most once a minute. */
export function touch(now = Date.now()) {
  try {
    const t = Number(localStorage.getItem(KEY));
    if (t > 0 && now - t < OPEN_FOR_MS && now - t > 60_000) localStorage.setItem(KEY, String(now));
  } catch { /* ignore */ }
}
