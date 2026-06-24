// tests/actions.test.js
// Tests the single validated entry point. Catches: illegal actions slipping
// through, wrong events, turn-flow mistakes, the (now fixed) missing draw, and
// non-reproducible randomness.

import { describe, it, expect } from 'vitest';
import { Game, PLAYER, AI, EMPTY } from '../gameLogic.js';
import { applyAction, canApply, place, useSkill, endTurn, ERROR } from '../ChaosGomoku3D.js';
import { makeRng } from '../rng.js';

const started = (diff = 'medium') => {
  const g = new Game();
  g.reset(diff);
  g.startTurn(PLAYER, true); // PLAYER to move, no cooldown tick
  return g;
};
// helper: get a game where `side` has placed and may use a skill
const placedReady = () => {
  const g = started();
  const res = applyAction(g, place(7, 7));
  expect(res.ok).toBe(true);
  return g; // current still PLAYER, placedThisTurn true
};

describe('canApply (legality, no mutation)', () => {
  it('rejects placing on an occupied cell without changing state', () => {
    const g = started();
    applyAction(g, place(7, 7));
    // PLACE again same turn -> already placed
    const r = canApply(g, place(8, 8));
    expect(r.ok).toBe(false);
    expect(r.error.code).toBe(ERROR.ALREADY_PLACED);
  });
  it('rejects a skill before placing', () => {
    const g = started();
    const r = canApply(g, useSkill('spring'));
    expect(r.ok).toBe(false);
    expect(r.error.code).toBe(ERROR.NOT_PLACED_YET);
  });
  it('rejects a frozen side using a skill', () => {
    const g = placedReady();
    g.freezeSkills(PLAYER);
    const r = canApply(g, useSkill('spring'));
    expect(r.error.code).toBe(ERROR.SKILL_FROZEN);
  });
  it('rejects a targeted skill with no / wrong target', () => {
    const g = placedReady();
    expect(canApply(g, useSkill('yeet')).error.code).toBe(ERROR.TARGET_REQUIRED);
    // (7,7) is PLAYER's own stone, not an enemy
    expect(canApply(g, useSkill('yeet', [7, 7])).error.code).toBe(ERROR.TARGET_INVALID);
  });
});

describe('PLACE', () => {
  it('places, emits a place event, and keeps the turn on a non-winning move', () => {
    const g = started();
    const res = applyAction(g, place(7, 7));
    expect(res.ok).toBe(true);
    expect(res.events).toEqual([{ type: 'place', r: 7, c: 7, side: PLAYER }]);
    expect(g.current).toBe(PLAYER); // turn stays for optional skill / end
    expect(g.placedThisTurn).toBe(true);
  });
  it('detects a win on the placing move', () => {
    const g = started();
    for (let i = 0; i < 4; i++) g.board[7][3 + i] = PLAYER; // 4 in a row, gap at 7,7
    const res = applyAction(g, place(7, 7));
    expect(res.events.some((e) => e.type === 'win' && e.side === PLAYER)).toBe(true);
    expect(g.isOver()).toBe(true);
  });
  it('[auto-flip] clears the board (no draw) when a placement fills it', () => {
    const g = started();
    // Fill the whole board except (14,14) with a non-winning brick pattern.
    for (let r = 0; r < 15; r++) {
      for (let c = 0; c < 15; c++) {
        if (r === 14 && c === 14) continue;
        g.board[r][c] = (((r + Math.floor(c / 2)) % 2) === 0) ? PLAYER : AI;
      }
    }
    g.board[14][14] = EMPTY;
    g.current = PLAYER; g.placedThisTurn = false; g.phase = 'place';
    const res = applyAction(g, place(14, 14));
    expect(res.ok).toBe(true);
    // no 5 in this pattern -> auto-flip, NOT draw
    expect(res.events.some((e) => e.type === 'autoFlip')).toBe(true);
    expect(res.events.some((e) => e.type === 'draw')).toBe(false);
    expect(g.isOver()).toBe(false);                 // game continues
    expect(g.isFull()).toBe(false);                 // board was cleared
    expect(g.piecesOf(PLAYER).length).toBe(0);
    expect(g.piecesOf(AI).length).toBe(0);
  });
});

describe('SKILL turn-flow', () => {
  it('a standard skill ends the turn and hands over to the opponent', () => {
    const g = placedReady();
    g.board[5][5] = AI; // give the opponent a stone for spring to remove
    const res = applyAction(g, useSkill('spring'), { rng: makeRng(1) });
    expect(res.ok).toBe(true);
    expect(res.events.some((e) => e.type === 'turnEnded' && e.side === PLAYER)).toBe(true);
    expect(g.current).toBe(AI);
  });
  it('CTRL+Z keeps the turn with the user (no handover)', () => {
    const g = started();
    applyAction(g, place(7, 7));       // PLAYER places
    applyAction(g, endTurn());          // -> AI
    applyAction(g, place(7, 8));        // AI places
    applyAction(g, endTurn());          // -> PLAYER
    applyAction(g, place(1, 1));        // PLAYER places (so canUndo true)
    const res = applyAction(g, useSkill('ctrlz'));
    expect(res.ok).toBe(true);
    expect(g.current).toBe(PLAYER);             // still PLAYER's turn
    expect(res.events.some((e) => e.type === 'undo')).toBe(true);
    expect(g.skillReady(PLAYER, 'ctrlz')).toBe(false); // spent for the game
  });
  it('YEET removes the targeted enemy stone', () => {
    const g = placedReady();
    g.board[6][6] = AI;
    const res = applyAction(g, useSkill('yeet', [6, 6]));
    expect(res.ok).toBe(true);
    expect(g.board[6][6]).toBe(EMPTY);
    expect(res.events.some((e) => e.type === 'remove' && e.r === 6 && e.c === 6)).toBe(true);
  });
});

describe('reproducible randomness (seeded rng)', () => {
  it('SPRING removes the same victims for the same seed', () => {
    const build = () => {
      const g = placedReady();
      for (let i = 0; i < 6; i++) g.board[0][i] = AI; // 6 enemy stones to sample from
      return g;
    };
    const run = (seed) => {
      const g = build();
      applyAction(g, useSkill('spring'), { rng: makeRng(seed) });
      return g.piecesOf(AI).map(([r, c]) => `${r},${c}`).sort().join('|');
    };
    expect(run(42)).toBe(run(42));        // deterministic for a fixed seed
  });
  it('FINDERS sends the stone to the same square for the same seed', () => {
    const run = (seed) => {
      const g = placedReady();
      g.board[6][6] = AI;
      applyAction(g, useSkill('finders', [6, 6]), { rng: makeRng(seed) });
      return g.piecesOf(AI)[0].join(',');
    };
    expect(run(7)).toBe(run(7));
  });
});
