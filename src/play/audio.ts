// Beeps and screen wake lock for the timer. Browsers only allow sound after a tap, so call unlock() from a button.
let ctx: AudioContext | null = null;

export function unlock() {
  try {
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!ctx && AC) ctx = new AC();
    void ctx?.resume();
  } catch {
    /* no sound available */
  }
}

export function beep(count = 1, freq = 880) {
  if (!ctx) return;
  const c = ctx;
  for (let i = 0; i < count; i++) {
    const t0 = c.currentTime + i * 0.28;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.4, t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
    osc.connect(gain).connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + 0.24);
  }
}

/** A short pip for the countdown. */
export function pip(high = false) {
  beep(1, high ? 1320 : 1000);
}

/** The end-of-game buzzer: loud, rough and long enough to be heard across the hall. */
export function buzzer() {
  if (!ctx) return;
  const c = ctx;
  const t0 = c.currentTime;
  for (const f of [220, 223]) {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'sawtooth';
    osc.frequency.value = f;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.5, t0 + 0.03);
    gain.gain.setValueAtTime(0.5, t0 + 1.1);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.4);
    osc.connect(gain).connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + 1.45);
  }
}

/** The "go" tone at the end of a changeover: one long, higher note. */
export function goTone() {
  if (!ctx) return;
  const c = ctx;
  const t0 = c.currentTime;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = 'square';
  osc.frequency.value = 880;
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(0.35, t0 + 0.02);
  gain.gain.setValueAtTime(0.35, t0 + 0.55);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.8);
  osc.connect(gain).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + 0.85);
}

let lock: any = null;
export async function keepAwake(on: boolean) {
  try {
    if (on) {
      if (!lock && 'wakeLock' in navigator) lock = await (navigator as any).wakeLock.request('screen');
    } else if (lock) {
      await lock.release();
      lock = null;
    }
  } catch {
    lock = null;
  }
}
