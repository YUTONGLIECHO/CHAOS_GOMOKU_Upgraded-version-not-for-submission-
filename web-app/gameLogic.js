// gameLogic.js
// Authoritative, render-agnostic game state for CHAOS GOMOKU 3D.
// This module knows NOTHING about Three.js. The board array is the single
// source of truth; meshes are always rebuilt from here, never the reverse.
//
// This is the INTERNAL ENGINE. External code (UI, AI, tests) should not drive
// the `Game` instance method-by-method; it should go through the public façade
// in ChaosGomoku3D.js (createGame / applyAction / selectors). See ARCHITECTURE.md.

/**
 * @namespace GameLogic
 * @typedef {0} Empty                A cell with no stone.
 * @typedef {1} Player               Black, the human / first player.
 * @typedef {2} AIToken              White, the AI / second player.
 * @typedef {(1|2)} Side             A playing side.
 * @typedef {(0|1|2)} Cell           A board cell value.
 * @typedef {Cell[][]} Board         15×15 grid, board[row][col].
 * @typedef {('yeet'|'finders'|'spring'|'zero'|'ctrlz'|'corporate'|'flip')} SkillId
 * @typedef {{r:number, c:number, side:Side}} Move
 */


export const N = 15;            // 15 x 15 board
export const EMPTY = 0;
export const PLAYER = 1;        // black — "Local Meat Computer"
export const AI = 2;            // white — "Professor Beep-Boop"

export const opp = (s) => (s === PLAYER ? AI : PLAYER);

// Skill catalogue. `cd` is a cooldown in turns, or 'once' for once-per-game.
// `targeted` skills require the user to click an enemy piece first.
export const SKILLS = [
  { id: 'yeet',      name: 'YEET METEOR',            icon: '☄️', desc: 'Launch one enemy piece into low orbit.',        cd: 5,      targeted: true  },
  { id: 'finders',   name: 'FINDERS KEEPERS',        icon: '🧲', desc: 'Relocate one enemy piece to a random square.', cd: 4,      targeted: true  },
  { id: 'spring',    name: 'SPRING CLEANING',        icon: '🧹', desc: 'Sweep away 1\u20133 random enemy pieces.',     cd: 7,      targeted: false },
  { id: 'zero',      name: 'ABSOLUTE ZERO',          icon: '❄️', desc: "Freeze the enemy's skills next turn.",         cd: 5,      targeted: false },
  { id: 'ctrlz',     name: 'CTRL + Z',               icon: '↩️', desc: 'Undo the previous complete turn. Once per game.', cd: 'once', targeted: false },
  { id: 'corporate', name: 'CORPORATE RESTRUCTURING',icon: '🔄', desc: 'Swap every piece color. Synergy!',             cd: 'once', targeted: false },
  { id: 'flip',      name: 'TABLE FLIP',             icon: '🪑', desc: 'Clear the board through furniture violence.',   cd: 'once', targeted: false },
];
export const SKILL_BY_ID = Object.fromEntries(SKILLS.map((s) => [s.id, s]));

// Difficulty tuning consumed by ai.js.
// The three modes intentionally differ in behavior, not just thinking delay:
//   radius/maxCandidates : local search breadth (hard sees more of the fight)
//   depth                : tactical lookahead plies after the immediate move
//   blockProb            : chance it stops your one-move win
//   topK/jitter/blunder  : controlled imperfection/randomness
//   defW/offW            : defense/offense weights in the shared evaluator
//   fork                 : detects and blocks double-threat setups
//   panic/aggression     : skill-use personality
export const DIFFS = {
  easy: {
    label: 'Sleepy Toaster',
    desc: 'High randomness, short sight, sometimes misses blocks.',
    radius: 1, maxCandidates: 10, depth: 0, blockProb: 0.62, topK: 8,
    defW: 0.42, offW: 0.75, threatW: 0.35, jitter: 140, blunder: 0.18,
    fork: false, panic: 0.32, aggression: 0.10, delay: [360, 760],
  },
  medium: {
    label: 'Suspicious Pigeon',
    desc: 'Reliable one-move tactics, limited lookahead, occasional mistakes.',
    radius: 2, maxCandidates: 14, depth: 1, blockProb: 1.0, topK: 3,
    defW: 1.05, offW: 1.0, threatW: 0.9, jitter: 18, blunder: 0.04,
    fork: false, panic: 0.05, aggression: 0.22, delay: [520, 980],
  },
  hard: {
    label: 'Evil Chess Refrigerator',
    desc: 'Broader search, double-threat awareness, low randomness.',
    radius: 2, maxCandidates: 16, depth: 2, blockProb: 1.0, topK: 1,
    defW: 1.32, offW: 1.22, threatW: 1.25, jitter: 0, blunder: 0,
    fork: true, panic: 0, aggression: 0.18, delay: [620, 1120],
  },
};

const newBoard = () => Array.from({ length: N }, () => new Array(N).fill(EMPTY));
const clone = (o) => JSON.parse(JSON.stringify(o));

export class Game {
  constructor() { this.reset('medium'); }

  reset(difficulty = 'medium') {
    this.board = newBoard();
    this.current = PLAYER;        // player always moves first
    this.phase = 'menu';          // menu | place | skill | anim | over
    this.winner = null;           // null | PLAYER | AI | 'draw'
    this.winLine = null;          // array of [r,c] for the winning five
    this.lastMove = null;         // {r,c,side}
    this.cooldowns = { [PLAYER]: {}, [AI]: {} };
    this.usedOnce  = { [PLAYER]: {}, [AI]: {} };
    this.frozen    = { [PLAYER]: false, [AI]: false };
    this.placedThisTurn = false;
    this.usedSkillThisTurn = false;
    this.turnLog = [];            // per-turn snapshots for CTRL + Z
    this.difficulty = difficulty;
  }

  // ---- board helpers ----------------------------------------------------
  inBounds(r, c) { return r >= 0 && r < N && c >= 0 && c < N; }
  isEmpty(r, c)  { return this.inBounds(r, c) && this.board[r][c] === EMPTY; }

  emptyCells() {
    const out = [];
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (this.board[r][c] === EMPTY) out.push([r, c]);
    return out;
  }
  piecesOf(side) {
    const out = [];
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (this.board[r][c] === side) out.push([r, c]);
    return out;
  }
  isFull() { return this.board.every((row) => row.every((v) => v !== EMPTY)); }

  /**
   * Place a stone if the target cell is empty and in bounds.
   * @param {number} r Row.
   * @param {number} c Column.
   * @param {Side} side
   * @returns {boolean} true if placed; false if illegal (state unchanged).
   */
  placePiece(r, c, side) {
    if (!this.isEmpty(r, c)) return false;
    this.board[r][c] = side;
    this.lastMove = { r, c, side };
    return true;
  }
  removeAt(r, c) { if (this.inBounds(r, c)) this.board[r][c] = EMPTY; }

  // returns the winning five cells for `side`, or null
  /**
   * Find a winning run of exactly five for `side`.
   * @param {Side} side
   * @returns {number[][]|null} The five winning [row,col] cells, or null.
   */
  findFive(side) {
    const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        if (this.board[r][c] !== side) continue;
        for (const [dr, dc] of dirs) {
          const cells = [[r, c]];
          let rr = r + dr, cc = c + dc;
          while (this.inBounds(rr, cc) && this.board[rr][cc] === side && cells.length < 5) {
            cells.push([rr, cc]); rr += dr; cc += dc;
          }
          if (cells.length === 5) return cells;
        }
      }
    }
    return null;
  }

  // ---- cooldowns / freeze ----------------------------------------------
  tickCooldowns(side) {
    const cd = this.cooldowns[side];
    for (const id in cd) if (cd[id] > 0) cd[id]--;
  }
  setCooldown(side, id) {
    const def = SKILL_BY_ID[id];
    if (def.cd === 'once') this.usedOnce[side][id] = true;
    else this.cooldowns[side][id] = def.cd;
  }
  skillReady(side, id) {
    const def = SKILL_BY_ID[id];
    if (def.cd === 'once') return !this.usedOnce[side][id];
    return (this.cooldowns[side][id] || 0) === 0;
  }
  // can `side` legally begin using a skill at this exact moment?
  canUseSkillNow(side) {
    return this.placedThisTurn && !this.usedSkillThisTurn &&
           !this.frozen[side] && this.phase === 'place' && !this.isOver();
  }
  freezeSkills(targetSide) { this.frozen[targetSide] = true; }
  markSkillUsed(side, id) { this.usedSkillThisTurn = true; this.setCooldown(side, id); }

  isOver() { return this.winner !== null; }

  // ---- snapshots (for CTRL + Z) ----------------------------------------
  // NOTE: usedOnce is intentionally NOT snapshotted/restored. A "once per game"
  // skill (flip / corporate) stays spent even if the turn is later undone, so
  // it is truly once-per-game and identical for both the player and the AI.
  snapshot() {
    return {
      board: clone(this.board),
      current: this.current,
      winner: this.winner,
      winLine: this.winLine ? clone(this.winLine) : null,
      lastMove: this.lastMove ? clone(this.lastMove) : null,
      cooldowns: clone(this.cooldowns),
      frozen: clone(this.frozen),
    };
  }
  restore(snap) {
    this.board = clone(snap.board);
    this.current = snap.current;
    this.winner = snap.winner;
    this.winLine = snap.winLine ? clone(snap.winLine) : null;
    this.lastMove = snap.lastMove ? clone(snap.lastMove) : null;
    this.cooldowns = clone(snap.cooldowns);
    this.frozen = clone(snap.frozen);
  }

  // ---- turn flow --------------------------------------------------------
  // Begin a turn for `side`. Records a snapshot so CTRL + Z can rewind here.
  startTurn(side, skipCooldownTick = false) {
    this.current = side;
    this.placedThisTurn = false;
    this.usedSkillThisTurn = false;
    this.phase = this.isOver() ? 'over' : 'place';
    if (!skipCooldownTick) this.tickCooldowns(side);
    this.turnLog.push({ snap: this.snapshot(), mover: side, wasUndo: false });
    if (this.turnLog.length > 40) this.turnLog.shift();
  }
  // End `side`'s turn: consume their freeze, hand over to the opponent.
  endTurn(side) {
    this.frozen[side] = false;        // a freeze lasts exactly one of their turns
    if (this.isOver()) { this.phase = 'over'; return; }
    this.startTurn(opp(side));
  }

  // ---- CTRL + Z ---------------------------------------------------------
  canUndo(side) {
    if (this.isOver()) return false;
    const o = opp(side);
    for (let i = this.turnLog.length - 1; i >= 0; i--) {
      if (this.turnLog[i].mover === o && !this.turnLog[i].wasUndo) return true;
    }
    return false;
  }
  // Rewind the opponent's previous (non-undo) turn and re-grant `side` a turn.
  undoLastOpponentTurn(side) {
    const o = opp(side);
    let idx = -1;
    for (let i = this.turnLog.length - 1; i >= 0; i--) {
      if (this.turnLog[i].mover === o && !this.turnLog[i].wasUndo) { idx = i; break; }
    }
    if (idx < 0) return false;
    this.restore(this.turnLog[idx].snap);
    this.turnLog.length = idx;          // drop the opponent + current entries
    this.setCooldown(side, 'ctrlz');    // CTRL + Z is once-per-game: this marks it spent
    this.winner = null; this.winLine = null;
    // fresh turn for `side`, WITHOUT re-ticking cooldowns
    this.current = side;
    this.placedThisTurn = false;
    this.usedSkillThisTurn = false;
    this.phase = 'place';
    this.turnLog.push({ snap: this.snapshot(), mover: side, wasUndo: true });
    return true;
  }

  // ---- skill state mutations (visual side handled by effects.js) --------
  swapAllColors() {
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      if (this.board[r][c] === PLAYER) this.board[r][c] = AI;
      else if (this.board[r][c] === AI) this.board[r][c] = PLAYER;
    }
  }
  clearBoard() { this.board = newBoard(); this.lastMove = null; this.winLine = null; }

  // Resolve a winner after a skill mutated the board. Returns
  // { winner, line } or null. Honors the CORPORATE paperwork tie-rule.
  resolveAfterSkill(skillUserSide, skillId) {
    const fiveP = this.findFive(PLAYER);
    const fiveA = this.findFive(AI);
    if (skillId === 'corporate' && fiveP && fiveA) {
      // both sides made five at once -> the skill USER loses (bad paperwork)
      const loser = skillUserSide;
      const winnerSide = opp(loser);
      return { winner: winnerSide, line: winnerSide === PLAYER ? fiveP : fiveA };
    }
    if (fiveP && fiveA) {
      // ambiguous: favor the skill user
      return { winner: skillUserSide, line: skillUserSide === PLAYER ? fiveP : fiveA };
    }
    if (fiveP) return { winner: PLAYER, line: fiveP };
    if (fiveA) return { winner: AI, line: fiveA };
    return null;
  }

  setWinner(side, line) { this.winner = side; this.winLine = line || null; this.phase = 'over'; }
  setDraw() { this.winner = 'draw'; this.winLine = null; this.phase = 'over'; }
}
