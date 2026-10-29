import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addPlayer, removePlayer, newSession, nextRound, redrawLast, canRedraw, setScore, leaderboard, parseNames,
  seededRng, autoPair, buildHistory, activePlayers, playingCapacity, setRating, RoundNotReady, updatePlayer,
} from './engine.ts';
import type { Session, Round } from './engine.ts';

function makeSession(n: number, courts: number, format: 'mixer' | 'fixed' | 'ladder' = 'mixer', opts: Partial<Session['settings']> = {}): Session {
  let s = newSession('t', 'Test', '2026-10-28');
  s.settings = { ...s.settings, courts, format, ...opts };
  for (let i = 1; i <= n; i++) s = addPlayer(s, `P${i}`, { gender: i % 2 ? 'M' : 'F' });
  return s;
}

function play(s: Session, rounds: number, rng = seededRng(1), score?: (r: Round) => void): Session {
  for (let i = 0; i < rounds; i++) {
    const r = nextRound(s, rng);
    // give every match a result so ladders can move on
    for (const m of r.matches) {
      m.scoreA = 11;
      m.scoreB = Math.floor(rng() * 10);
    }
    if (score) score(r);
    s = { ...s, rounds: [...s.rounds, r] };
  }
  return s;
}

function checkRoundInvariants(s: Session, r: Round) {
  const seen = new Set<string>();
  for (const m of r.matches) {
    for (const id of [...m.a, ...m.b]) {
      assert.ok(!seen.has(id), `player ${id} twice in round ${r.number}`);
      seen.add(id);
    }
    assert.equal(m.a.length, 2);
    assert.equal(m.b.length, 2);
  }
  for (const id of r.sitting) {
    assert.ok(!seen.has(id), `player ${id} both sitting and playing`);
    seen.add(id);
  }
  const active = new Set(activePlayers(s).map((p) => p.id));
  assert.deepEqual([...seen].sort(), [...active].sort(), 'every active player is playing or sitting');
  assert.ok(r.matches.length <= s.settings.courts);
  assert.equal(r.matches.length * 4, playingCapacity(active.size, s.settings.courts));
  const courts = r.matches.map((m) => m.court);
  assert.deepEqual(courts, courts.map((_, i) => i + 1));
}

test('parseNames strips bullets, numbers and blanks', () => {
  assert.deepEqual(parseNames('1. Ann\n- Bob\n• Cat, Dan;  \n\n 5) Eve'), ['Ann', 'Bob', 'Cat', 'Dan', 'Eve']);
});

test('mixer: every round is valid for 4 to 26 players and 1 to 6 courts', () => {
  for (let n = 4; n <= 26; n++) {
    for (let courts = 1; courts <= 6; courts++) {
      let s = makeSession(n, courts);
      const rng = seededRng(n * 100 + courts);
      for (let i = 0; i < 10; i++) {
        const r = nextRound(s, rng);
        checkRoundInvariants(s, r);
        s = { ...s, rounds: [...s.rounds, r] };
      }
    }
  }
});

test('mixer: games and sit-outs are shared fairly (spread of at most 1)', () => {
  for (const [n, courts] of [[5, 1], [9, 2], [10, 2], [13, 3], [17, 4], [22, 5], [26, 6]] as const) {
    const s = play(makeSession(n, courts), 12, seededRng(n));
    const h = buildHistory(s);
    const games = s.players.map((p) => h.games.get(p.id) ?? 0);
    assert.ok(Math.max(...games) - Math.min(...games) <= 1, `n=${n} courts=${courts} games ${games}`);
  }
});

test('mixer: partners rotate well (8 players, 7 rounds)', () => {
  let worst = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const s = play(makeSession(8, 2), 7, seededRng(seed));
    const h = buildHistory(s);
    worst = Math.max(worst, ...h.partners.values());
  }
  console.log('  8 players/7 rounds: worst repeat-partner count over 20 seeds =', worst);
  assert.ok(worst <= 2);
});

test('mixer: partner variety with 12 players over 11 rounds', () => {
  const s = play(makeSession(12, 3), 11, seededRng(5));
  const h = buildHistory(s);
  const worst = Math.max(...h.partners.values());
  console.log('  12 players/11 rounds: worst repeat-partner count =', worst, ', distinct partnerships =', h.partners.size, 'of 66');
  assert.ok(worst <= 2);
});

test('mixer: people added and removed mid-session', () => {
  let s = play(makeSession(10, 2), 3, seededRng(3));
  const gone = s.players[0].id;
  s = removePlayer(s, gone);
  s = addPlayer(s, 'Late Larry');
  const larry = s.players.find((p) => p.name === 'Late Larry')!;
  for (let i = 0; i < 4; i++) {
    const r = nextRound(s, seededRng(50 + i));
    checkRoundInvariants(s, r);
    const ids = r.matches.flatMap((m) => [...m.a, ...m.b]);
    assert.ok(!ids.includes(gone) && !r.sitting.includes(gone), 'removed player never appears');
    if (i === 0) assert.ok(ids.includes(larry.id), 'late arrival plays straight away');
    s = { ...s, rounds: [...s.rounds, r] };
  }
  // welcome back: re-adding the same name reactivates, no duplicate
  const before = s.players.length;
  s = addPlayer(s, s.players[0].name);
  assert.equal(s.players.length, before);
  assert.ok(s.players[0].active);
});

test('mixer: preferMixed pairs a man with a woman every time (6 men, 6 women)', () => {
  const s = play(makeSession(12, 3, 'mixer', { preferMixed: true }), 8, seededRng(9));
  for (const r of s.rounds) {
    for (const m of r.matches) {
      for (const side of [m.a, m.b]) {
        const g = side.map((id) => s.players.find((p) => p.id === id)!.gender).sort().join('');
        assert.equal(g, 'FM');
      }
    }
  }
});

test('mixer: balanceLevels gives closer matches than random', () => {
  const mk = (balance: boolean) => {
    let s = makeSession(16, 4, 'mixer', { balanceLevels: balance });
    s = { ...s, players: s.players.map((p, i) => ({ ...p, level: (i % 5) + 1 })) };
    return s;
  };
  const gap = (s: Session) => {
    let total = 0, n = 0;
    for (const r of s.rounds) for (const m of r.matches) {
      const lv = (ids: string[]) => ids.reduce((x, id) => x + s.players.find((p) => p.id === id)!.level, 0);
      total += Math.abs(lv(m.a) - lv(m.b)); n++;
    }
    return total / n;
  };
  const plain = gap(play(mk(false), 8, seededRng(2)));
  const balanced = gap(play(mk(true), 8, seededRng(2)));
  console.log('  average level gap per match: random', plain.toFixed(2), 'balanced', balanced.toFixed(2));
  assert.ok(balanced < plain);
});

test('mixer: redraw replaces an unscored round, refuses once scored', () => {
  let s = makeSession(8, 2);
  s = { ...s, rounds: [nextRound(s, seededRng(1))] };
  assert.ok(canRedraw(s));
  s = addPlayer(s, 'New');
  const again = redrawLast(s, seededRng(2));
  assert.equal(again.number, 1);
  checkRoundInvariants({ ...s, rounds: [] }, again);
  s = setScore(s, 1, 1, 11, 4);
  assert.ok(!canRedraw(s));
  assert.throws(() => redrawLast(s));
});

test('fixed pairs: every team meets a new opponent (8 teams, 7 rounds)', () => {
  let s = makeSession(16, 4, 'fixed');
  s = { ...s, pairs: autoPair(s, seededRng(4)) };
  assert.equal(s.pairs.length, 8);
  const done = play(s, 7, seededRng(6));
  const h = buildHistory(done);
  const worst = Math.max(...h.pairOpponents.values());
  console.log('  fixed 8 teams/7 rounds: worst repeat-opponent count =', worst);
  assert.ok(worst <= 2);
  for (const r of done.rounds) assert.equal(r.matches.length, 4);
});

test('fixed pairs: odd number of teams rotates byes, and more teams than courts share the courts', () => {
  let s = makeSession(14, 3, 'fixed');
  s = { ...s, pairs: autoPair(s, seededRng(4)) };
  const done = play(s, 7, seededRng(8));
  const h = buildHistory(done);
  const games = s.pairs.map(([x]) => h.games.get(x) ?? 0);
  assert.ok(Math.max(...games) - Math.min(...games) <= 1, `games ${games}`);
  for (const r of done.rounds) assert.ok(r.matches.length <= 3);
});

test('fixed pairs: an odd player is left unpaired and sits', () => {
  let s = makeSession(9, 2, 'fixed');
  s = { ...s, pairs: autoPair(s, seededRng(4)) };
  assert.equal(s.pairs.length, 4);
  const r = nextRound(s, seededRng(1));
  const paired = new Set(s.pairs.flat());
  const odd = s.players.find((p) => !paired.has(p.id))!;
  assert.ok(r.sitting.includes(odd.id));
});

test('fixed pairs: removing one half of a pair drops that pair from the draw', () => {
  let s = makeSession(8, 2, 'fixed');
  s = { ...s, pairs: autoPair(s, seededRng(4)) };
  const [x, y] = s.pairs[0];
  s = removePlayer(s, x);
  const r = nextRound(s, seededRng(1));
  const ids = r.matches.flatMap((m) => [...m.a, ...m.b]);
  assert.ok(!ids.includes(x));
  assert.ok(!ids.includes(y));
  assert.ok(r.sitting.includes(y));
});

test('ladder: needs scores, then winners move up and losers move down', () => {
  let s = makeSession(12, 3, 'ladder');
  const r1 = nextRound(s, seededRng(1));
  s = { ...s, rounds: [r1] };
  assert.throws(() => nextRound(s, seededRng(2)), RoundNotReady);
  // side A wins on every court
  for (const m of r1.matches) { m.scoreA = 11; m.scoreB = 5; }
  const r2 = nextRound(s, seededRng(2));
  checkRoundInvariants(s, r2);
  const W = r1.matches.map((m) => m.a);
  const L = r1.matches.map((m) => m.b);
  const set = (ids: string[]) => ids.slice().sort().join();
  assert.equal(set(r2.matches[0].a.concat(r2.matches[0].b)), set([...W[0], ...W[1]]), 'court 1 = winners of courts 1 and 2');
  assert.equal(set(r2.matches[1].a.concat(r2.matches[1].b)), set([...W[2], ...L[0]]), 'court 2 = winners of 3 and losers of 1');
  assert.equal(set(r2.matches[2].a.concat(r2.matches[2].b)), set([...L[2], ...L[1]]), 'court 3 = losers of 3 and 2');
});

test('ladder: a draw must be fixed before the next round', () => {
  let s = makeSession(8, 2, 'ladder');
  const r1 = nextRound(s, seededRng(1));
  r1.matches[0].scoreA = 10; r1.matches[0].scoreB = 10;
  r1.matches[1].scoreA = 11; r1.matches[1].scoreB = 3;
  s = { ...s, rounds: [r1] };
  assert.throws(() => nextRound(s, seededRng(2)), /draw/);
});

test('ladder: valid for many sizes, with sit-outs shared round the bench', () => {
  for (const [n, courts] of [[5, 1], [9, 2], [10, 2], [11, 3], [14, 3], [18, 4], [23, 5]] as const) {
    let s = makeSession(n, courts, 'ladder');
    const rng = seededRng(n);
    for (let i = 0; i < 14; i++) {
      const r = nextRound(s, rng);
      checkRoundInvariants(s, r);
      for (const m of r.matches) { m.scoreA = rng() < 0.5 ? 11 : rng() * 10 | 0; m.scoreB = m.scoreA === 11 ? 4 : 11; }
      s = { ...s, rounds: [...s.rounds, r] };
    }
    const h = buildHistory(s);
    const games = s.players.map((p) => h.games.get(p.id) ?? 0);
    assert.ok(Math.min(...games) >= 1, `n=${n}: someone never played ${games}`);
    assert.ok(Math.max(...games) - Math.min(...games) <= 6, `n=${n}: games spread ${games}`);
  }
});

test('ladder: players leaving and joining mid-session', () => {
  let s = makeSession(12, 3, 'ladder');
  const rng = seededRng(11);
  for (let i = 0; i < 6; i++) {
    const r = nextRound(s, rng);
    checkRoundInvariants(s, r);
    for (const m of r.matches) { m.scoreA = 11; m.scoreB = rng() * 10 | 0; }
    s = { ...s, rounds: [...s.rounds, r] };
    if (i === 1) s = removePlayer(s, s.players[3].id);
    if (i === 2) { s = addPlayer(s, 'Late A'); s = addPlayer(s, 'Late B'); }
    if (i === 3) s = removePlayer(s, s.players[5].id);
  }
});

test('leaderboard totals and ordering', () => {
  let s = makeSession(4, 1);
  const [a, b, c, d] = s.players.map((p) => p.id);
  s = { ...s, rounds: [
    { number: 1, sitting: [], matches: [{ court: 1, a: [a, b], b: [c, d], scoreA: 11, scoreB: 7 }] },
    { number: 2, sitting: [], matches: [{ court: 1, a: [a, c], b: [b, d], scoreA: 11, scoreB: 9 }] },
  ] };
  const lb = leaderboard(s);
  assert.equal(lb[0].id, a); // two wins
  assert.equal(lb[0].won, 2);
  assert.equal(lb[0].diff, 6);
  assert.equal(lb.find((r) => r.id === d)!.lost, 2);
  assert.equal(lb.find((r) => r.id === b)!.won, 1);
  assert.equal(lb.find((r) => r.id === b)!.lost, 1);
});

test('ratings can be set, noted and cleared', () => {
  let s = makeSession(4, 1);
  const id = s.players[0].id;
  s = setRating(s, id, 3, 'Solid at the kitchen');
  assert.deepEqual(s.ratings[id], { level: 3, note: 'Solid at the kitchen' });
  s = setRating(s, id, 0, '');
  assert.equal(s.ratings[id], undefined);
  s = updatePlayer(s, id, { level: 4 });
  assert.equal(s.players[0].level, 4);
});

test('needs at least four players', () => {
  assert.throws(() => nextRound(makeSession(3, 1)), /at least four/);
});

import { parseSpondList, addExpected, checkIn, checkInAll, notComing, expectedPlayers } from './engine.ts';

test('parseSpondList: plain list, bullets, numbers, commas', () => {
  assert.deepEqual(parseSpondList('1. Ann Smith\n- Bob Jones\nCat Lee, Dan Moss; Eve Ray'), ['Ann Smith', 'Bob Jones', 'Cat Lee', 'Dan Moss', 'Eve Ray']);
});

test('parseSpondList: takes only the accepted section when there are headings', () => {
  const text = 'Accepted (3)\nAnn Smith\nBob Jones\nCat Lee\nDeclined (2)\nDan Moss\nEve Ray\nUnanswered (1)\nFay Hunt\nWaiting list\nGus Pike';
  assert.deepEqual(parseSpondList(text), ['Ann Smith', 'Bob Jones', 'Cat Lee']);
});

test('parseSpondList: ignores emails, times, counts, emoji, repeats and menu words', () => {
  const text = 'Attending 4\nAnn Smith 🎾\nbob@example.com\n19:00\nBob Jones (2)\nann smith\nShow more\nGuests\n12';
  assert.deepEqual(parseSpondList(text), ['Ann Smith', 'Bob Jones']);
});

test('parseSpondList: table rows keep only accepted people', () => {
  assert.deepEqual(parseSpondList('Ann Smith\tAccepted\nBob Jones\tDeclined\nCat Lee\tAttending'), ['Ann Smith', 'Cat Lee']);
});

test('parseSpondList: empty or junk gives nothing', () => {
  assert.deepEqual(parseSpondList(''), []);
  assert.deepEqual(parseSpondList('\n\n  \n'), []);
});

test('expected players are not drawn until checked in; late arrivals join and play', () => {
  let s = newSession('x', 'Wed', '2026-10-28');
  s.settings = { ...s.settings, courts: 3 };
  s = addExpected(s, ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'].map((n) => ({ name: n })));
  assert.equal(activePlayers(s).length, 0);
  assert.equal(expectedPlayers(s).length, 9);
  assert.throws(() => nextRound(s), /at least four/);
  // eight turn up, one is late, one is not coming
  for (const p of expectedPlayers(s).filter((p) => !['H', 'I'].includes(p.name))) s = checkIn(s, p.id);
  assert.equal(activePlayers(s).length, 7);
  s = checkIn(s, s.players.find((p) => p.name === 'H')!.id);
  s = notComing(s, s.players.find((p) => p.name === 'I')!.id);
  assert.equal(s.players.find((p) => p.name === 'I'), undefined, 'no-show is dropped');
  const r1 = nextRound(s, seededRng(1));
  checkRoundInvariants(s, r1);
  s = { ...s, rounds: [r1] };
  s = addPlayer(s, 'Walker', { walkIn: true });
  assert.ok(s.players.find((p) => p.name === 'Walker')!.walkIn);
  const r2 = nextRound(s, seededRng(2));
  checkRoundInvariants(s, r2);
  assert.ok(r2.matches.flatMap((m) => [...m.a, ...m.b]).includes(s.players.find((p) => p.name === 'Walker')!.id), 'walk-in plays straight away');
});

test('checkInAll, and importing the same name twice does not duplicate', () => {
  let s = newSession('x', 'Wed', '2026-10-28');
  s = addExpected(s, [{ name: 'Ann' }, { name: 'Bob' }]);
  s = addExpected(s, [{ name: 'ann' }, { name: 'Cat' }]);
  assert.equal(s.players.length, 3);
  s = checkInAll(s);
  assert.equal(activePlayers(s).length, 3);
  assert.equal(expectedPlayers(s).length, 0);
  s = addExpected(s, [{ name: 'Bob' }]);
  assert.equal(s.players.length, 3);
});

test('notComing never drops someone who is already here', () => {
  let s = addPlayer(newSession('x', 'Wed', '2026-10-28'), 'Ann');
  s = notComing(s, s.players[0].id);
  assert.equal(s.players.length, 1);
});

import { candidatesFromText } from './engine.ts';

test('candidatesFromText marks accepted when the paste has headings', () => {
  assert.deepEqual(candidatesFromText('Accepted (2)\nAnn\nBob\nDeclined\nCat'), [{ name: 'Ann', status: 'yes' }, { name: 'Bob', status: 'yes' }]);
  assert.deepEqual(candidatesFromText('Ann\nBob'), [{ name: 'Ann', status: 'unknown' }, { name: 'Bob', status: 'unknown' }]);
});

test('fetching the Spond list again does not duplicate someone whose name was corrected', () => {
  let s = newSession('x', 'Wed', '2026-10-28');
  s = addExpected(s, [{ name: 'Eve Ray' }, { name: 'Ann' }]);
  const eve = s.players.find((p) => p.name === 'Eve Ray')!;
  s = updatePlayer(s, eve.id, { name: 'Evie Ray' });
  s = checkIn(s, eve.id);
  s = addExpected(s, [{ name: 'Eve Ray' }, { name: 'Ann' }, { name: 'Late Larry' }]);
  assert.deepEqual(s.players.map((p) => p.name).sort(), ['Ann', 'Evie Ray', 'Late Larry']);
});

test('a name corrected in the preview keeps its Spond spelling for next time', () => {
  let s = newSession('x', 'Wed', '2026-10-28');
  s = addExpected(s, [{ name: 'Evie Ray', source: 'Eve Ray' }]);
  s = addExpected(s, [{ name: 'Eve Ray' }]);
  assert.equal(s.players.length, 1);
  assert.equal(s.players[0].name, 'Evie Ray');
});
