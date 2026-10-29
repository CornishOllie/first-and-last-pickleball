// Round timer: a game of N minutes, then a changeover of M minutes, then "ready" for the next round.
// All state is plain data based on timestamps, so it survives a throttled tab or a page reload.

export type Phase = 'idle' | 'game' | 'change' | 'ready';

export interface TimerState {
  phase: Phase;
  running: boolean;
  /** Epoch ms when the current phase ends (only while running). */
  endsAt: number | null;
  /** Milliseconds left in the current phase (only while paused). */
  remainingMs: number | null;
}

export interface TimerSettings {
  gameMinutes: number;
  changeoverMinutes: number;
}

export const idleTimer = (): TimerState => ({ phase: 'idle', running: false, endsAt: null, remainingMs: null });

const ms = (minutes: number) => Math.max(0, Math.round(minutes * 60_000));

export function startGame(t: TimerSettings, now: number): TimerState {
  return { phase: 'game', running: true, endsAt: now + ms(t.gameMinutes), remainingMs: null };
}

export function pause(state: TimerState, now: number): TimerState {
  if (!state.running || state.endsAt === null) return state;
  return { ...state, running: false, endsAt: null, remainingMs: Math.max(0, state.endsAt - now) };
}

export function resume(state: TimerState, now: number): TimerState {
  if (state.running || state.remainingMs === null) return state;
  return { ...state, running: true, endsAt: now + state.remainingMs, remainingMs: null };
}

export function remaining(state: TimerState, now: number): number {
  if (state.phase === 'idle' || state.phase === 'ready') return 0;
  if (state.running && state.endsAt !== null) return Math.max(0, state.endsAt - now);
  return state.remainingMs ?? 0;
}

export type TimerEvent = 'game-over' | 'change-over' | null;

/** Move the timer on if the current phase has run out. Returns the new state and what just finished. */
export function tick(state: TimerState, t: TimerSettings, now: number): { state: TimerState; event: TimerEvent } {
  if (!state.running || state.endsAt === null || now < state.endsAt) return { state, event: null };
  if (state.phase === 'game') {
    if (ms(t.changeoverMinutes) === 0) return { state: { phase: 'ready', running: false, endsAt: null, remainingMs: null }, event: 'game-over' };
    // carry on from the moment the game actually ended, so a late tick doesn't lose time
    return { state: { phase: 'change', running: true, endsAt: state.endsAt + ms(t.changeoverMinutes), remainingMs: null }, event: 'game-over' };
  }
  if (state.phase === 'change') {
    return { state: { phase: 'ready', running: false, endsAt: null, remainingMs: null }, event: 'change-over' };
  }
  return { state, event: null };
}

/** Skip straight to the next phase (for example to start the changeover early). */
export function skip(state: TimerState, t: TimerSettings, now: number): TimerState {
  if (state.phase === 'game') {
    if (ms(t.changeoverMinutes) === 0) return { phase: 'ready', running: false, endsAt: null, remainingMs: null };
    return { phase: 'change', running: true, endsAt: now + ms(t.changeoverMinutes), remainingMs: null };
  }
  if (state.phase === 'change') return { phase: 'ready', running: false, endsAt: null, remainingMs: null };
  return state;
}

export function formatClock(msLeft: number): string {
  const total = Math.ceil(msLeft / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
