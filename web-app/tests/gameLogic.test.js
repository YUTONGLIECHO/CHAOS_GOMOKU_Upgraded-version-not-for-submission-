// tests/gameLogic.test.js
// Unit + invariant tests for the authoritative game module.
// Each describe notes which class of bug it is meant to catch.

import { describe, it, expect } from 'vitest';
import {
  Game, N, EMPTY, PLAYER, AI, opp, SKILL_BY_ID,
} from '../gameLogic.js';
import { assertValidBoard, countSide } from './invariants.js';

const fresh = (diff = 'medium') => {
  const g = new Game();
  g.reset(diff);
  return g;
};
// Put a run of `side` starting at (r,c) stepping by (dr,dc). Bypasses turn flow
// on purpose: these tests target findFive, not the turn machinery.
const placeRun = (g, r, c, dr, dc, len, side) => {
  for (let i = 0; i < len; i++) g.board[r + dr * i][c + dc * i] = side;
};

// ── Catches: bad initial state / reset regressions ────────────────────────────
describe('reset / empty board', () => {
  it('starts empty, player to move, not over, valid shape', () => {
    const g = fresh();
    assertValidBoard(g.board);
    expect(g.current).toBe(PLAYER);
    expect(g.isOver()).toBe(false);
    expect(g.winner).toBe(null);
    expect(countSide(g.board, PLAYER)).toBe(0);
    expect(countSide(g.board, AI)).toBe(0);
  });
});

// ── Catches: illegal placement silently mutating state ────────────────────────
describe('placePiece legality', () => {
  it('places on empty and records lastMove', () => {
    const g = fresh();
    expect(g.placePiece(7, 7, PLAYER)).toBe(true);
    expect(g.board[7][7]).toBe(PLAYER);
    expect(g.lastMove).toEqual({ r: 7, c: 7, side: PLAYER });
  });
  it('refuses an occupied cell and does not overwrite', () => {
    const g = fresh();
    g.placePiece(7, 7, PLAYER);
    expect(g.placePiece(7, 7, AI)).toBe(false);
    expect(g.board[7][7]).toBe(PLAYER); // unchanged
  });
  it('refuses out-of-bounds without throwing', () => {
    const g = fresh();
    expect(g.placePiece(-1, 0, PLAYER)).toBe(false);
    expect(g.placePiece(N, 0, PLAYER)).toBe(false);
  });
});

// ── Catches: win-detection errors on any of the four axes ─────────────────────
describe('findFive', () => {
  it('detects horizontal / vertical / both diagonals', () => {
    let g = fresh(); placeRun(g, 7, 3, 0, 1, 5, PLAYER);
    expect(g.findFive(PLAYER)).not.toBeNull();
    g = fresh(); placeRun(g, 3, 7, 1, 0, 5, AI);
    expect(g.findFive(AI)).not.toBeNull();
    g = fresh(); placeRun(g, 3, 3, 1, 1, 5, PLAYER);
    expect(g.findFive(PLAYER)).not.toBeNull();
    g = fresh(); placeRun(g, 3, 11, 1, -1, 5, AI);
    expect(g.findFive(AI)).not.toBeNull();
  });
  it('does NOT treat four-in-a-row as a win', () => {
    const g = fresh(); placeRun(g, 7, 3, 0, 1, 4, PLAYER);
    expect(g.findFive(PLAYER)).toBeNull();
  });
  // DOCUMENTS CURRENT BEHAVIOUR (open rule decision: see RULES.md TODO):
  // an overline (6+) currently counts as a win (free-style gomoku).
  it('[rule:overline] currently counts 6-in-a-row as a win', () => {
    const g = fresh(); placeRun(g, 7, 2, 0, 1, 6, PLAYER);
    expect(g.findFive(PLAYER)).not.toBeNull();
  });
});

// ── Catches: cooldown / once-per-game accounting bugs ─────────────────────────
describe('cooldowns & once-skills', () => {
  it('setCooldown + tick decrements to ready', () => {
    const g = fresh();
    g.setCooldown(PLAYER, 'yeet'); // cd 5
    expect(g.skillReady(PLAYER, 'yeet')).toBe(false);
    for (let i = 0; i < SKILL_BY_ID.yeet.cd; i++) g.tickCooldowns(PLAYER);
    expect(g.skillReady(PLAYER, 'yeet')).toBe(true);
  });
  it('once-skills stay spent for the rest of the game', () => {
    const g = fresh();
    g.setCooldown(PLAYER, 'flip'); // once
    expect(g.skillReady(PLAYER, 'flip')).toBe(false);
    g.tickCooldowns(PLAYER); // ticking must NOT revive a once-skill
    expect(g.skillReady(PLAYER, 'flip')).toBe(false);
  });
});

// ── Catches: freeze / turn-gating regressions ─────────────────────────────────
describe('canUseSkillNow gating', () => {
  it('requires placed-this-turn, not already-used, not frozen, phase=place', () => {
    const g = fresh();
    g.startTurn(PLAYER, true);
    expect(g.canUseSkillNow(PLAYER)).toBe(false); // hasn't placed yet
    g.placedThisTurn = true;
    expect(g.canUseSkillNow(PLAYER)).toBe(true);
    g.freezeSkills(PLAYER);
    expect(g.canUseSkillNow(PLAYER)).toBe(false); // frozen
  });
});

// ── Catches: snapshot/restore not being an isolated deep copy ─────────────────
describe('snapshot / restore round-trip', () => {
  it('restores an equivalent board and is decoupled from later mutation', () => {
    const g = fresh();
    g.placePiece(7, 7, PLAYER);
    const snap = g.snapshot();
    g.placePiece(7, 8, AI); // mutate AFTER snapshot
    expect(snap.board[7][8]).toBe(EMPTY); // snapshot not affected
    g.restore(snap);
    expect(g.board[7][8]).toBe(EMPTY); // restored
    expect(g.board[7][7]).toBe(PLAYER);
    assertValidBoard(g.board);
  });
});

// ── Catches: CTRL+Z corrupting state or reviving once-skills ──────────────────
describe('CTRL+Z (undoLastOpponentTurn)', () => {
  it('rewinds the opponent move, keeps once-skills spent, and is itself once-per-game', () => {
    const g = fresh();
    g.startTurn(PLAYER, true);
    g.placePiece(7, 7, PLAYER); g.placedThisTurn = true;
    g.markSkillUsed(PLAYER, 'flip'); // spend a once-skill this turn
    g.endTurn(PLAYER);               // -> AI
    g.placePiece(7, 8, AI); g.placedThisTurn = true;
    g.endTurn(AI);                   // -> PLAYER again
    expect(g.canUndo(PLAYER)).toBe(true);
    expect(g.undoLastOpponentTurn(PLAYER)).toBe(true);
    expect(g.board[7][8]).toBe(EMPTY);                 // AI move undone
    expect(g.skillReady(PLAYER, 'flip')).toBe(false);  // once-skill still spent
    expect(g.skillReady(PLAYER, 'ctrlz')).toBe(false); // ctrlz is now spent for the game
  });
  it('cannot be used a second time in the same game', () => {
    const g = fresh();
    g.startTurn(PLAYER, true);
    g.placePiece(7, 7, PLAYER); g.placedThisTurn = true;
    g.endTurn(PLAYER);
    g.placePiece(7, 8, AI); g.placedThisTurn = true;
    g.endTurn(AI);
    expect(g.undoLastOpponentTurn(PLAYER)).toBe(true); // first undo ok
    expect(g.skillReady(PLAYER, 'ctrlz')).toBe(false); // spent -> not ready again
  });
});

// ── Catches: skill-driven win resolution mistakes ─────────────────────────────
describe('resolveAfterSkill', () => {
  it('returns the lone five-maker', () => {
    const g = fresh();
    for (let i = 0; i < 5; i++) g.board[7][3 + i] = AI;
    const res = g.resolveAfterSkill(AI, 'spring');
    expect(res).not.toBeNull();
    expect(res.winner).toBe(AI);
  });
  it('CORPORATE double-five makes the SKILL USER lose (paperwork rule)', () => {
    const g = fresh();
    for (let i = 0; i < 5; i++) g.board[5][3 + i] = PLAYER;
    for (let i = 0; i < 5; i++) g.board[9][3 + i] = AI;
    const res = g.resolveAfterSkill(PLAYER, 'corporate'); // PLAYER used it
    expect(res.winner).toBe(AI); // user loses
  });
  it('returns null when nobody has five', () => {
    const g = fresh();
    expect(g.resolveAfterSkill(PLAYER, 'spring')).toBeNull();
  });
});

// ── Catches: board-wide skill mutations going wrong ───────────────────────────
describe('swapAllColors / clearBoard', () => {
  it('swapAllColors swaps every stone colour and keeps the board valid', () => {
    const g = fresh();
    g.board[0][0] = PLAYER; g.board[0][1] = AI; g.board[1][0] = EMPTY;
    g.swapAllColors();
    expect(g.board[0][0]).toBe(AI);
    expect(g.board[0][1]).toBe(PLAYER);
    expect(g.board[1][0]).toBe(EMPTY);
    assertValidBoard(g.board);
  });
  it('clearBoard empties everything', () => {
    const g = fresh();
    g.board[7][7] = PLAYER;
    g.clearBoard();
    expect(countSide(g.board, PLAYER)).toBe(0);
    expect(countSide(g.board, AI)).toBe(0);
  });
});

// ── opp() sanity ──────────────────────────────────────────────────────────────
describe('opp', () => {
  it('is an involution', () => {
    expect(opp(PLAYER)).toBe(AI);
    expect(opp(AI)).toBe(PLAYER);
    expect(opp(opp(PLAYER))).toBe(PLAYER);
  });
});
