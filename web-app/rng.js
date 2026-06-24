// src/game/rng.js
// A tiny, seedable random source so that randomised rules (SPRING's count and
// victims, FINDERS' destination) and, later, the AI can be made reproducible in
// tests. Inject an rng into applyAction; default to Math.random in production.

/**
 * @typedef {Object} Rng
 * @property {Function} next  Returns a float in [0, 1).
 * @property {Function} int   Given n, returns an integer in [0, n).
 * @property {Function} pick  Returns a uniformly chosen array element.
 */

/** The production rng, backed by Math.random. @type {Rng} */
export const defaultRng = {
  next: () => Math.random(),
  int: (n) => (Math.random() * n) | 0,
  pick: (arr) => arr[(Math.random() * arr.length) | 0],
};

/**
 * Deterministic rng (mulberry32) for tests and replays.
 * @param {number} seed
 * @returns {Rng}
 */
export function makeRng(seed = 1) {
  let a = seed >>> 0;
  const next = () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n) => Math.floor(next() * n);
  const pick = (arr) => arr[int(arr.length)];
  return { next, int, pick };
}

/**
 * In-place Fisher-Yates shuffle using an injected rng (proper uniform shuffle,
 * unlike the biased sort(() => rng-0.5) idiom it replaces). Returns the array.
 * 
 * @param {Array} arr
 * @param {Rng} rng
 * @returns {Array}
 */
export function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
