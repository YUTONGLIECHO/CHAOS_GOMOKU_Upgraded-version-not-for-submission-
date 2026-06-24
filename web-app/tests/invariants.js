// tests/invariants.js
// Board invariants for CHAOS GOMOKU. Deliberately minimal: we only assert
// properties that are ACTUALLY true for this game, given that skills can
// add/remove/recolour stones (so e.g. token-count balance does NOT hold the
// way it does in plain Connect-4 / Gomoku).
//
// This mirrors the spirit of the reference project's throw_if_invalid, but is
// honest about which invariants survive the chaos skills.

import { N, EMPTY, PLAYER, AI } from '../gameLogic.js';

const TOKENS = new Set([EMPTY, PLAYER, AI]);

/**
 * Throws if `board` is not a structurally valid N×N board of legal tokens.
 * @param {number[][]} board
 */
export function assertValidBoard(board) {
  if (!Array.isArray(board) || board.length !== N) {
    throw new Error(`board is not an array of length ${N}`);
  }
  board.forEach((row, r) => {
    if (!Array.isArray(row) || row.length !== N) {
      throw new Error(`row ${r} is not an array of length ${N}`);
    }
    row.forEach((v, c) => {
      if (!TOKENS.has(v)) {
        throw new Error(`illegal token ${JSON.stringify(v)} at (${r},${c})`);
      }
    });
  });
}

/** Count tokens of a given side on the board. */
export function countSide(board, side) {
  let n = 0;
  for (const row of board) for (const v of row) if (v === side) n++;
  return n;
}

/** Deep structural equality for two boards (cheap, board-only). */
export function boardsEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let r = 0; r < a.length; r++) {
    if (a[r].length !== b[r].length) return false;
    for (let c = 0; c < a[r].length; c++) if (a[r][c] !== b[r][c]) return false;
  }
  return true;
}
