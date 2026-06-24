// tests/characters.test.js
// Character roster + selection-state logic (pure, no DOM). UI interaction is
// covered by the manual checklist in README / ARCHITECTURE, not faked here.

import { describe, it, expect } from 'vitest';
import {
  PLAYER_CHARACTERS,
  NPC_AVATARS,
  NPC_CHARACTERS,
  DEFAULT_CHARACTER_ID,
  getCharacter,
  isValidCharacterId,
  coerceCharacterId,
} from '../characters.js';
import {
  STORAGE_KEY,
  normalizeSelection,
  loadSelection,
  saveSelection,
} from '../characterSelect.js';
import { Game, PLAYER } from '../gameLogic.js';
import { applyAction, place, createGame } from '../ChaosGomoku3D.js';

// a tiny in-memory localStorage stand-in
function fakeStore(initial = {}) {
  const m = new Map(Object.entries(initial));
  return {
    _m: m,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
  };
}
const throwingStore = {
  getItem() { throw new Error('blocked'); },
  setItem() { throw new Error('blocked'); },
};

describe('player roster', () => {
  it('has exactly 5 player characters', () => {
    expect(PLAYER_CHARACTERS).toHaveLength(5);
  });
  it('ids are unique and stable', () => {
    const ids = PLAYER_CHARACTERS.map((c) => c.id);
    expect(new Set(ids).size).toBe(5);
    expect(ids).toEqual(['player-01', 'player-02', 'player-03', 'player-04', 'player-05']);
  });
  it('every character has a non-empty avatar path under assets/avatars', () => {
    for (const c of PLAYER_CHARACTERS) {
      expect(typeof c.avatar).toBe('string');
      expect(c.avatar.length).toBeGreaterThan(0);
      expect(c.avatar).toContain('assets/avatars/');
      expect(c.name && c.name.length).toBeGreaterThan(0);
    }
  });
  it('default character id is valid', () => {
    expect(isValidCharacterId(DEFAULT_CHARACTER_ID)).toBe(true);
    expect(getCharacter(DEFAULT_CHARACTER_ID)).toBeTruthy();
  });
  it('coerce maps invalid ids to the default', () => {
    expect(coerceCharacterId('nope')).toBe(DEFAULT_CHARACTER_ID);
    expect(coerceCharacterId('player-03')).toBe('player-03');
    expect(isValidCharacterId('doctor-beepboop')).toBe(false);
  });
});

describe('NPC avatars', () => {
  it('doctor + ai paths are present and non-empty', () => {
    expect(NPC_AVATARS.doctor).toContain('assets/avatars/');
    expect(NPC_AVATARS.ai).toContain('assets/avatars/');
  });
  it('NPCs are NOT part of the selectable player roster', () => {
    const ids = PLAYER_CHARACTERS.map((c) => c.id);
    expect(ids).not.toContain(NPC_CHARACTERS.doctor.id);
    expect(ids).not.toContain(NPC_CHARACTERS.ai.id);
  });
});

describe('normalizeSelection', () => {
  it('AI mode keeps player-two null', () => {
    const s = normalizeSelection({ playerOneCharacterId: 'player-02' }, 'ai');
    expect(s.mode).toBe('ai');
    expect(s.playerOneCharacterId).toBe('player-02');
    expect(s.playerTwoCharacterId).toBeNull();
  });
  it('invalid ids fall back to default', () => {
    const s = normalizeSelection({ playerOneCharacterId: 'bogus' }, 'ai');
    expect(s.playerOneCharacterId).toBe(DEFAULT_CHARACTER_ID);
  });
  it('local mode resolves duplicates by default', () => {
    const s = normalizeSelection({ playerOneCharacterId: 'player-02', playerTwoCharacterId: 'player-02' }, 'local');
    expect(s.playerOneCharacterId).toBe('player-02');
    expect(s.playerTwoCharacterId).not.toBe('player-02');
    expect(isValidCharacterId(s.playerTwoCharacterId)).toBe(true);
  });
  it('local mode allows duplicates when opted in', () => {
    const s = normalizeSelection(
      { playerOneCharacterId: 'player-02', playerTwoCharacterId: 'player-02' },
      'local',
      { allowDuplicates: true },
    );
    expect(s.playerTwoCharacterId).toBe('player-02');
  });
});

describe('persistence (localStorage)', () => {
  it('round-trips a saved selection under the versioned key', () => {
    const store = fakeStore();
    saveSelection(store, { playerOneCharacterId: 'player-04', playerTwoCharacterId: 'player-01' });
    expect(store.getItem(STORAGE_KEY)).toBeTruthy();
    const back = loadSelection(store, 'local');
    expect(back.playerOneCharacterId).toBe('player-04');
    expect(back.playerTwoCharacterId).toBe('player-01');
  });
  it('AI mode load ignores any stored player-two (ai uses the robot avatar)', () => {
    const store = fakeStore();
    saveSelection(store, { playerOneCharacterId: 'player-03', playerTwoCharacterId: 'player-05' });
    const back = loadSelection(store, 'ai');
    expect(back.playerOneCharacterId).toBe('player-03');
    expect(back.playerTwoCharacterId).toBeNull();
  });
  it('corrupt JSON falls back to a valid default', () => {
    const store = fakeStore({ [STORAGE_KEY]: '{not json' });
    const back = loadSelection(store, 'ai');
    expect(back.playerOneCharacterId).toBe(DEFAULT_CHARACTER_ID);
  });
  it('missing data falls back to a valid default', () => {
    const back = loadSelection(fakeStore(), 'local');
    expect(isValidCharacterId(back.playerOneCharacterId)).toBe(true);
    expect(isValidCharacterId(back.playerTwoCharacterId)).toBe(true);
  });
  it('save/load never throw even if storage is blocked', () => {
    expect(saveSelection(throwingStore, { playerOneCharacterId: 'player-01', playerTwoCharacterId: null })).toBe(false);
    const back = loadSelection(throwingStore, 'ai');
    expect(back.playerOneCharacterId).toBe(DEFAULT_CHARACTER_ID);
  });
  it('selection survives a simulated reload (same store, fresh load)', () => {
    const store = fakeStore();
    saveSelection(store, { playerOneCharacterId: 'player-05', playerTwoCharacterId: null });
    // ...time passes, page reloads, code re-reads the same storage...
    expect(loadSelection(store, 'ai').playerOneCharacterId).toBe('player-05');
  });
});

describe('selection is NOT core game state', () => {
  it('a fresh game state carries no character fields', () => {
    const g = createGame('medium');
    expect(g).not.toHaveProperty('playerOneCharacterId');
    expect(g).not.toHaveProperty('playerTwoCharacterId');
    expect(g).not.toHaveProperty('selection');
  });
  it('applyAction result state is unaffected by any selection', () => {
    const g = new Game(); g.reset('medium'); g.startTurn(PLAYER, true);
    const res = applyAction(g, place(7, 7));
    expect(res.ok).toBe(true);
    expect(res.state).not.toHaveProperty('playerOneCharacterId');
    // board mutated as normal; no avatar leakage
    expect(JSON.stringify(res.events)).not.toMatch(/avatar|character/i);
  });
});
