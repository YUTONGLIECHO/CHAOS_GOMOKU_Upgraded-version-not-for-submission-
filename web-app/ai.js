// ai.js
// "Professor Beep-Boop" — opponent move + skill selection.
// Pure logic: reads the authoritative Game state, returns decisions.
// Never mutates the board; main.js applies the chosen action.

import { N, EMPTY, PLAYER, AI, opp, DIFFS } from './gameLogic.js';

export const THINK_MSGS = [
  'Calculating emotional damage\u2026',
  'Consulting forbidden geometry\u2026',
  'Downloading confidence\u2026',
  'Pretending this is difficult\u2026',
  'Reviewing your questionable decisions\u2026',
];

export const AI_DIALOGUE = {
  easy: [
    'Is this... my turn? Neat.',
    'I pressed a button. Something happened.',
    'Beep. Boop. Vibes.',
    'I read the rules once. In a dream.',
  ],
  medium: [
    'Predictable. Like a microwave.',
    'I have seen this opening in 4,000 nightmares.',
    'Calculating... done. You will not enjoy this.',
    'Smug subroutine engaged.',
  ],
  hard: [
    'Your defeat compiles cleanly.',
    'I have already won. Time is a formality.',
    'Resistance noted. Resistance dismissed.',
    'I dreamed of this board. I dreamed of your loss.',
  ],
};
export const pick = (arr) => arr[(Math.random() * arr.length) | 0];

const inB = (r, c) => r >= 0 && r < N && c >= 0 && c < N;
const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];

// Would placing `side` at (r,c) complete a five?
function placingWins(board, r, c, side) {
  if (board[r][c] !== EMPTY) return false;
  for (const [dr, dc] of DIRS) {
    let count = 1;
    for (const s of [1, -1]) {
      let rr = r + dr * s, cc = c + dc * s;
      while (inB(rr, cc) && board[rr][cc] === side) { count++; rr += dr * s; cc += dc * s; }
    }
    if (count >= 5) return true;
  }
  return false;
}

// Cells within `radius` of any existing stone (keeps search local & fast).
function candidateCells(board, radius = 2) {
  const seen = new Set(); const out = [];
  let any = false;
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    if (board[r][c] === EMPTY) continue;
    any = true;
    for (let dr = -radius; dr <= radius; dr++) for (let dc = -radius; dc <= radius; dc++) {
      const rr = r + dr, cc = c + dc;
      if (inB(rr, cc) && board[rr][cc] === EMPTY) {
        const k = rr * N + cc;
        if (!seen.has(k)) { seen.add(k); out.push([rr, cc]); }
      }
    }
  }
  if (!any) return [[7, 7]]; // empty board -> play center
  return out;
}

function orderedCandidates(board, cfg, side = AI) {
  const scored = candidateCells(board, cfg.radius || 2)
    .map(([r, c]) => ({ r, c, s: scoreCell(board, r, c, side, cfg.defW, cfg.offW) }));
  scored.sort((a, b) => b.s - a.s);
  return scored.slice(0, cfg.maxCandidates || scored.length).map(({ r, c }) => [r, c]);
}

// Score a single open line run for threat weighting.
function lineScore(open, run) {
  if (run >= 5) return 1e7;
  if (run === 4) return open === 2 ? 1e6 : (open === 1 ? 9000 : 0);
  if (run === 3) return open === 2 ? 1200 : (open === 1 ? 180 : 0);
  if (run === 2) return open === 2 ? 90 : (open === 1 ? 18 : 0);
  if (run === 1) return open === 2 ? 8 : 2;
  return 0;
}

// Evaluate value of placing `side` at (r,c): own offense + blocking value.
function scoreCell(board, r, c, side, defW, offW = 1) {
  const foe = opp(side);
  let off = 0, def = 0;
  for (const test of [side, foe]) {
    for (const [dr, dc] of DIRS) {
      let run = 1, open = 0;
      for (const s of [1, -1]) {
        let rr = r + dr * s, cc = c + dc * s;
        while (inB(rr, cc) && board[rr][cc] === test) { run++; rr += dr * s; cc += dc * s; }
        if (inB(rr, cc) && board[rr][cc] === EMPTY) open++;
      }
      const v = lineScore(open, run);
      if (test === side) off += v; else def += v;
    }
  }
  // central bias keeps early play sane
  const center = 7 - (Math.abs(r - 7) + Math.abs(c - 7)) / 2;
  return off * offW + def * defW + center;
}

// Find a cell where `side` would create two+ simultaneous winning threats.
function bestForkCell(board, side, cfg) {
  let best = null, bestN = 1;
  for (const [r, c] of orderedCandidates(board, cfg, side)) {
    board[r][c] = side;
    const t = countWinningThreats(board, side);
    board[r][c] = EMPTY;
    if (t >= 2 && t > bestN) { bestN = t; best = [r, c]; }
  }
  return best;
}

// Count how many distinct winning replies `side` would have next move:
// used to detect/prefer forks (double threats).
function countWinningThreats(board, side) {
  let n = 0;
  for (const [r, c] of candidateCells(board, 1)) {
    if (placingWins(board, r, c, side)) n++;
  }
  return n;
}

function countLineThreats(board, side) {
  let openFour = 0, four = 0, openThree = 0;
  for (const [r, c] of candidateCells(board, 1)) {
    if (board[r][c] !== EMPTY) continue;
    for (const [dr, dc] of DIRS) {
      let run = 1, open = 0;
      for (const s of [1, -1]) {
        let rr = r + dr * s, cc = c + dc * s;
        while (inB(rr, cc) && board[rr][cc] === side) { run++; rr += dr * s; cc += dc * s; }
        if (inB(rr, cc) && board[rr][cc] === EMPTY) open++;
      }
      if (run >= 4 && open === 2) openFour++;
      else if (run >= 4 && open === 1) four++;
      else if (run === 3 && open === 2) openThree++;
    }
  }
  return { openFour, four, openThree };
}

function threatValue(board, side) {
  const wins = countWinningThreats(board, side);
  const t = countLineThreats(board, side);
  return wins * 220000 + t.openFour * 90000 + t.four * 14000 + t.openThree * 2600;
}

function bestReplyScore(board, cfg, side, depth, stats) {
  const cands = orderedCandidates(board, { ...cfg, maxCandidates: Math.min(cfg.maxCandidates || 12, 10) }, side);
  let best = -Infinity;
  for (const [r, c] of cands) {
    const v = evaluateMove(board, r, c, side, cfg, depth, stats);
    if (v > best) best = v;
  }
  return Number.isFinite(best) ? best : 0;
}

function evaluateMove(board, r, c, side, cfg, depth = 0, stats = null) {
  if (stats) stats.nodes++;
  const foe = opp(side);
  let total = scoreCell(board, r, c, side, cfg.defW, cfg.offW);
  board[r][c] = side;
  total += threatValue(board, side) * (cfg.threatW || 1);
  total -= threatValue(board, foe) * (cfg.defW || 1) * 0.75;

  if (depth >= 1) {
    const foeBest = bestReplyScore(board, cfg, foe, 0, stats);
    total -= foeBest * 0.55;
  }
  if (depth >= 2) {
    const foeCands = orderedCandidates(board, { ...cfg, maxCandidates: 4 }, foe);
    let worstAfterReply = Infinity;
    for (const [fr, fc] of foeCands) {
      board[fr][fc] = foe;
      const myReply = bestReplyScore(board, { ...cfg, maxCandidates: 6 }, side, 0, stats);
      board[fr][fc] = EMPTY;
      if (myReply < worstAfterReply) worstAfterReply = myReply;
    }
    if (Number.isFinite(worstAfterReply)) total += worstAfterReply * 0.28;
  }

  board[r][c] = EMPTY;
  return total;
}

function bestThreatReduction(board, cands, cfg) {
  const current = threatValue(board, PLAYER);
  if (current < 2600 || (cfg.depth || 0) < 1) return null;
  let best = null, bestDanger = current, bestScore = -Infinity;
  for (const [r, c] of cands) {
    board[r][c] = AI;
    const danger = threatValue(board, PLAYER);
    const score = scoreCell(board, r, c, AI, cfg.defW, cfg.offW);
    board[r][c] = EMPTY;
    if (danger < bestDanger || (danger === bestDanger && score > bestScore)) {
      bestDanger = danger;
      bestScore = score;
      best = [r, c];
    }
  }
  return best && bestDanger < current ? best : null;
}

export function chooseMove(game, difficulty) {
  const start = performance.now();
  const cfg = DIFFS[difficulty] || DIFFS.medium;
  const board = game.board;
  const cands = orderedCandidates(board, cfg, AI);
  const stats = { nodes: 0, candidates: cands.length, depth: cfg.depth || 0 };
  const done = (move) => ({ ...move, aiMs: performance.now() - start, nodes: stats.nodes, candidates: stats.candidates, depth: stats.depth });

  // 1) immediate win
  for (const [r, c] of cands) if (placingWins(board, r, c, AI)) return done({ r, c, score: 1e7, why: 'win' });

  // 2) block an immediate player win (probabilistically on easy)
  const playerWins = cands.filter(([r, c]) => placingWins(board, r, c, PLAYER));
  if (playerWins.length && Math.random() < cfg.blockProb) {
    const [r, c] = playerWins[0];
    return done({ r, c, score: 9e6, why: 'block' });
  }
  const intentionallyMissedBlock = playerWins.length > 0 && cfg.blockProb < 1;
  const blockKeys = new Set(playerWins.map(([r, c]) => `${r},${c}`));

  // Medium+ should visibly understand basic live-three / four pressure.
  const threatBlock = bestThreatReduction(board, cands, cfg);
  if (threatBlock) return done({ r: threatBlock[0], c: threatBlock[1], score: 3e5, why: 'threat-block' });

  // 3) forks (hard only): first try to CREATE a double threat of our own...
  if (cfg.fork) {
    const mine = bestForkCell(board, AI, cfg);
    if (mine) return done({ r: mine[0], c: mine[1], score: 5e5, why: 'fork' });
    // ...then deny the player's double-threat setup before it forms.
    const theirs = bestForkCell(board, PLAYER, cfg);
    if (theirs) return done({ r: theirs[0], c: theirs[1], score: 4e5, why: 'block-fork' });
  }

  // 4) heuristic: score all candidates, pick from the top-K (with jitter)
  const scored = cands.map(([r, c]) => {
    let s = evaluateMove(board, r, c, AI, cfg, cfg.depth || 0, stats) + Math.random() * cfg.jitter;
    if (intentionallyMissedBlock && blockKeys.has(`${r},${c}`)) s -= 1e6;
    return { r, c, s };
  });
  scored.sort((a, b) => b.s - a.s);
  let pool = scored.slice(0, Math.min(cfg.topK, scored.length));
  if (cfg.blunder && scored.length > pool.length && Math.random() < cfg.blunder) {
    const start = Math.min(pool.length, scored.length - 1);
    const end = Math.min(scored.length, start + Math.max(2, cfg.topK));
    pool = scored.slice(start, end);
  }
  const choice = pool[(Math.random() * pool.length) | 0] || scored[0];
  return done({ r: choice.r, c: choice.c, score: choice.s, why: 'heuristic' });
}

// Decide whether (and how) the AI uses a skill AFTER it has placed a stone.
// Returns { id, target? } or null. target is [r,c] for targeted skills.
export function chooseSkill(game, difficulty) {
  const cfg = DIFFS[difficulty] || DIFFS.medium;
  if (!game.canUseSkillNow(AI)) return null;
  const board = game.board;

  const ready = (id) => game.skillReady(AI, id);
  const playerPieces = game.piecesOf(PLAYER);

  // Find the player's most dangerous stone (part of the strongest threat),
  // used as a target for YEET / FINDERS.
  function mostDangerousPlayerPiece() {
    let best = null, bestV = -1;
    for (const [r, c] of playerPieces) {
      // value = how much removing it reduces player threat
      let v = 0;
      for (const [dr, dc] of DIRS) {
        let run = 1, open = 0;
        for (const s of [1, -1]) {
          let rr = r + dr * s, cc = c + dc * s;
          while (inB(rr, cc) && board[rr][cc] === PLAYER) { run++; rr += dr * s; cc += dc * s; }
          if (inB(rr, cc) && board[rr][cc] === EMPTY) open++;
        }
        v += lineScore(open, run);
      }
      if (v > bestV) { bestV = v; best = [r, c]; }
    }
    return { cell: best, value: bestV };
  }

  // Does the player have an open-four-ish threat we should panic about?
  const danger = mostDangerousPlayerPiece();
  const emergency = danger.value >= 9000;   // open four / near-win
  const threat    = danger.value >= 1200;   // open three+

  // EMERGENCY: dismantle the player's winning structure.
  if (emergency) {
    if (ready('yeet') && danger.cell)    return { id: 'yeet', target: danger.cell };
    if (ready('finders') && danger.cell) return { id: 'finders', target: danger.cell };
    if (ready('spring'))                 return { id: 'spring' };
    if (ready('flip'))                   return { id: 'flip' };
  }

  // THREAT: chip away, or freeze the player so they can't counter our plan.
  if (threat && Math.random() < 0.7) {
    if (ready('spring'))                 return { id: 'spring' };
    if (ready('yeet') && danger.cell)    return { id: 'yeet', target: danger.cell };
    if (ready('zero'))                   return { id: 'zero' };
  }

  // STRATEGIC (hard tends to hoard powerful once-skills): occasional pressure.
  const aggression = cfg.aggression ?? (difficulty === 'hard' ? 0.18 : difficulty === 'medium' ? 0.28 : 0.12);
  if (Math.random() < aggression) {
    if (ready('zero'))                   return { id: 'zero' };
    if (ready('finders') && danger.cell) return { id: 'finders', target: danger.cell };
  }

  // EASY: sometimes fling a skill into the void for comedic value.
  if (difficulty === 'easy' && Math.random() < cfg.panic) {
    const goofy = ['spring', 'zero', 'finders'].filter(ready);
    if (goofy.length) {
      const id = pick(goofy);
      if (id === 'finders') return danger.cell ? { id, target: danger.cell } : null;
      return { id };
    }
  }

  return null;
}
