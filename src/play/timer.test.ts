import test from 'node:test';
import assert from 'node:assert/strict';
import { idleTimer, startGame, pause, resume, remaining, tick, skip, formatClock, pipSecond } from './timer.ts';

const T = { gameMinutes: 12, changeoverMinutes: 3 };
const MIN = 60_000;

test('a game counts down, then the changeover, then it is ready', () => {
  let s = startGame(T, 0);
  assert.equal(remaining(s, 0), 12 * MIN);
  assert.equal(remaining(s, 5 * MIN), 7 * MIN);
  let r = tick(s, T, 11 * MIN);
  assert.equal(r.event, null);
  r = tick(s, T, 12 * MIN);
  assert.equal(r.event, 'game-over');
  assert.equal(r.state.phase, 'change');
  assert.equal(remaining(r.state, 12 * MIN), 3 * MIN);
  const r2 = tick(r.state, T, 15 * MIN);
  assert.equal(r2.event, 'change-over');
  assert.equal(r2.state.phase, 'ready');
  assert.equal(r2.state.running, false);
});

test('a late tick (throttled tab) does not lose changeover time', () => {
  const s = startGame(T, 0);
  const r = tick(s, T, 13 * MIN); // one minute late
  assert.equal(r.state.phase, 'change');
  assert.equal(remaining(r.state, 13 * MIN), 2 * MIN);
});

test('pause freezes the clock and resume carries on', () => {
  let s = startGame(T, 0);
  s = pause(s, 4 * MIN);
  assert.equal(remaining(s, 99 * MIN), 8 * MIN);
  assert.equal(tick(s, T, 99 * MIN).event, null);
  s = resume(s, 10 * MIN);
  assert.equal(remaining(s, 10 * MIN), 8 * MIN);
  assert.equal(tick(s, T, 18 * MIN).event, 'game-over');
});

test('no changeover goes straight to ready', () => {
  const t0 = { gameMinutes: 10, changeoverMinutes: 0 };
  const r = tick(startGame(t0, 0), t0, 10 * MIN);
  assert.equal(r.event, 'game-over');
  assert.equal(r.state.phase, 'ready');
});

test('skip moves to the next phase', () => {
  let s = startGame(T, 0);
  s = skip(s, T, 2 * MIN);
  assert.equal(s.phase, 'change');
  assert.equal(remaining(s, 2 * MIN), 3 * MIN);
  s = skip(s, T, 3 * MIN);
  assert.equal(s.phase, 'ready');
  assert.equal(idleTimer().phase, 'idle');
});

test('clock formatting rounds up so 0:00 only shows at the end', () => {
  assert.equal(formatClock(12 * MIN), '12:00');
  assert.equal(formatClock(59_001), '1:00');
  assert.equal(formatClock(61_000), '1:01');
  assert.equal(formatClock(500), '0:01');
  assert.equal(formatClock(0), '0:00');
});

test('pips: a game pips for its last 5 seconds only, once per second', () => {
  assert.equal(pipSecond('game', true, 6000, null), null);
  assert.equal(pipSecond('game', true, 5000, null), 5);
  assert.equal(pipSecond('game', true, 4600, 5), null); // same second, already sounded
  assert.equal(pipSecond('game', true, 4000, 5), 4);
  assert.equal(pipSecond('game', true, 1, 2), 1);
  assert.equal(pipSecond('game', true, 0, 1), null); // the buzzer takes over
});

test('pips: a changeover pips for its last 3 seconds, and nothing when paused or idle', () => {
  assert.equal(pipSecond('change', true, 4000, null), null);
  assert.equal(pipSecond('change', true, 3000, null), 3);
  assert.equal(pipSecond('change', false, 3000, null), null);
  assert.equal(pipSecond('idle', true, 2000, null), null);
  assert.equal(pipSecond('ready', true, 2000, null), null);
});
