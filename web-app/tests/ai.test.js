// tests/ai.test.js
// The AI must only ever return LEGAL actions through the same state the human
// uses. These tests catch the AI proposing occupied/out-of-bounds cells, and
// failing to take an immediate win or block.

import { describe, it, expect, vi } from 'vitest';
import { Game, PLAYER, AI, DIFFS } from '../gameLogic.js';
import { chooseMove } from '../ai.js';
import { assertValidBoard } from './invariants.js';

const fresh = (diff = 'medium') => { const g = new Game(); g.reset(diff); return g; };
const key = (mv) => `${mv.r},${mv.c}`;

function withRandom(values, fn) {
  const seq = Array.isArray(values) ? values : [values];
  let i = 0;
  const spy = vi.spyOn(Math, 'random').mockImplementation(() => seq[i++ % seq.length]);
  try { return fn(); } finally { spy.mockRestore(); }
}

function twoCandidateBoard() {
  const g = fresh();
  g.board[7][7] = AI;
  g.board[7][8] = PLAYER;
  g.board[6][7] = AI;
  return g;
}

function liveThreeThreatBoard() {
  const g = fresh();
  g.board[6][5] = PLAYER;
  g.board[6][6] = PLAYER;
  g.board[6][7] = PLAYER;
  g.board[8][7] = AI;
  g.board[9][7] = AI;
  return g;
}

function twoStepBoard() {
  const g = fresh();
  g.board[7][5] = AI;
  g.board[7][6] = AI;
  g.board[8][5] = AI;
  g.board[8][6] = AI;
  g.board[6][6] = PLAYER;
  g.board[9][9] = PLAYER;
  return g;
}

describe('chooseMove legality', () => {
  it('opens in the centre on an empty board', () => {
    const g = fresh();
    const mv = chooseMove(g, 'medium');
    expect(mv).toMatchObject({ r: 7, c: 7 });
  });

  it('never returns an occupied or out-of-bounds cell (random boards)', () => {
    for (const diff of ['easy', 'medium', 'hard']) {
      for (let trial = 0; trial < 40; trial++) {
        const g = fresh(diff);
        // sprinkle some random stones, leaving the board non-full
        const stones = 10 + ((Math.random() * 60) | 0);
        for (let i = 0; i < stones; i++) {
          const r = (Math.random() * 15) | 0;
          const c = (Math.random() * 15) | 0;
          g.board[r][c] = Math.random() < 0.5 ? PLAYER : AI;
        }
        const mv = chooseMove(g, diff);
        expect(g.isEmpty(mv.r, mv.c)).toBe(true);
      }
    }
  });

  it('takes an immediate win when one exists', () => {
    const g = fresh('hard');
    for (let i = 0; i < 4; i++) g.board[7][3 + i] = AI; // AI four-in-a-row open at 7,7
    const mv = chooseMove(g, 'hard');
    expect(mv.why).toBe('win');
    expect(g.isEmpty(mv.r, mv.c)).toBe(true);
    g.placePiece(mv.r, mv.c, AI);
    expect(g.findFive(AI)).not.toBeNull();
  });

  it('blocks the player’s immediate win on reliable difficulties', () => {
    const g = fresh('hard'); // blockProb 1.0
    for (let i = 0; i < 4; i++) g.board[7][3 + i] = PLAYER; // player threatens 7,7
    const mv = chooseMove(g, 'hard');
    // hard should either block at an end of the four or otherwise prevent it
    g.placePiece(mv.r, mv.c, AI);
    // after AI's reply the player must NOT have a free immediate five at both ends
    const ends = [[7, 2], [7, 7]];
    const openEnds = ends.filter(([r, c]) => g.isEmpty(r, c));
    expect(openEnds.length).toBeLessThan(2);
  });
});

describe('AI difficulty behavior', () => {
  it('uses different settings for each difficulty', () => {
    expect(DIFFS.easy.depth).toBeLessThan(DIFFS.medium.depth);
    expect(DIFFS.medium.depth).toBeLessThan(DIFFS.hard.depth);
    expect(DIFFS.easy.topK).toBeGreaterThan(DIFFS.medium.topK);
    expect(DIFFS.medium.topK).toBeGreaterThan(DIFFS.hard.topK);
    expect(DIFFS.easy.jitter).toBeGreaterThan(DIFFS.medium.jitter);
    expect(DIFFS.medium.jitter).toBeGreaterThanOrEqual(DIFFS.hard.jitter);
    expect(DIFFS.hard.fork).toBe(true);
    expect(DIFFS.easy.fork).toBe(false);
  });

  it('all difficulties take an immediate win before any randomness', () => {
    for (const diff of ['easy', 'medium', 'hard']) {
      const g = fresh(diff);
      for (let i = 0; i < 4; i++) g.board[7][3 + i] = AI;
      const mv = withRandom(0.99, () => chooseMove(g, diff));
      expect(mv.why).toBe('win');
      g.placePiece(mv.r, mv.c, AI);
      expect(g.findFive(AI)).not.toBeNull();
    }
  });

  it('blocks one-move wins on medium and hard', () => {
    const setup = () => {
      const g = fresh();
      for (let i = 0; i < 4; i++) g.board[7][3 + i] = PLAYER;
      return g;
    };

    expect(withRandom(0.01, () => chooseMove(setup(), 'easy')).why).toBe('block');
    expect(withRandom(0.99, () => chooseMove(setup(), 'easy')).why).not.toBe('block');
    expect(withRandom(0.99, () => chooseMove(setup(), 'medium')).why).toBe('block');
    expect(withRandom(0.99, () => chooseMove(setup(), 'hard')).why).toBe('block');
  });

  it('easy has controlled random variety while hard is stable on the same board', () => {
    const easyA = withRandom(0.01, () => chooseMove(twoCandidateBoard(), 'easy'));
    const easyB = withRandom(0.9, () => chooseMove(twoCandidateBoard(), 'easy'));
    const hardA = withRandom(0.01, () => chooseMove(twoCandidateBoard(), 'hard'));
    const hardB = withRandom(0.9, () => chooseMove(twoCandidateBoard(), 'hard'));

    expect(key(easyA)).not.toBe(key(easyB));
    expect(key(hardA)).toBe(key(hardB));
  });

  it('medium/hard react to a live-three style threat more reliably than easy', () => {
    const easy = withRandom(0.8, () => chooseMove(liveThreeThreatBoard(), 'easy'));
    const medium = withRandom(0.8, () => chooseMove(liveThreeThreatBoard(), 'medium'));
    const hard = withRandom(0.8, () => chooseMove(liveThreeThreatBoard(), 'hard'));

    expect(['6,4', '6,8']).toContain(key(medium));
    expect(['6,4', '6,8']).toContain(key(hard));
    expect(['threat-block', 'block-fork']).toContain(hard.why);
    expect(key(easy)).not.toBe(key(hard));
  });

  it('fixed seeds are repeatable and every difficulty remains legal on tactical boards', () => {
    for (const diff of ['easy', 'medium', 'hard']) {
      const a = withRandom([0.2, 0.4, 0.6], () => chooseMove(twoStepBoard(), diff));
      const b = withRandom([0.2, 0.4, 0.6], () => chooseMove(twoStepBoard(), diff));
      expect(key(a)).toBe(key(b));
      const g = twoStepBoard();
      expect(g.isEmpty(a.r, a.c)).toBe(true);
    }
  });

  it('reset stores the chosen difficulty used by a new AI turn', () => {
    const g = fresh('easy');
    expect(g.difficulty).toBe('easy');
    g.reset('hard');
    expect(g.difficulty).toBe('hard');
    const mv = withRandom(0.5, () => chooseMove(g, g.difficulty));
    expect(g.isEmpty(mv.r, mv.c)).toBe(true);
  });
});

describe('full game simulation (smoke)', () => {
  it('keeps AI-vs-AI moves legal during a long run', () => {
    for (const [pd, ad] of [['easy', 'easy'], ['medium', 'medium'], ['easy', 'hard']]) {
      const g = fresh(ad);
      g.startTurn(PLAYER, true);
      let plies = 0;
      let _flips = 0;
      while (!g.isOver() && plies < 600) {
        const side = g.current;
        const mv = chooseMove(g, side === PLAYER ? pd : ad);
        expect(g.isEmpty(mv.r, mv.c)).toBe(true); // never illegal
        g.placePiece(mv.r, mv.c, side);
        g.placedThisTurn = true;
        assertValidBoard(g.board);
        const five = g.findFive(side);
        if (five) { g.setWinner(side, five); break; }
        if (g.isFull()) { g.clearBoard(); _flips++; } // auto-flip, keep playing (no draw)
        g.endTurn(side);
        plies++;
      }
      // It must either end with a winner or still be running cleanly at the cap.
      expect(g.winner === PLAYER || g.winner === AI || plies >= 600).toBe(true);
      expect(g.winner).not.toBe('draw'); // draws no longer exist
    }
  });
});
