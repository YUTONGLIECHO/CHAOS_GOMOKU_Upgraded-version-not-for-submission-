/**
 * Character selection helpers and UI controller.
 *
 * Character choice is cosmetic. It is saved locally and is not part of the
 * `Game` rule state.
 * Tests import the pure helpers only; DOM work happens when the browser
 * controller is built.
 *
 * @module characterSelect
 */
import {
  PLAYER_CHARACTERS,
  NPC_CHARACTERS,
  DEFAULT_CHARACTER_ID,
  coerceCharacterId,
} from './characters.js';

/** Stable localStorage key (versioned). @type {string} */
export const STORAGE_KEY = 'chaos-gomoku-3d.character-selection.v1';

/**
 * Normalise an arbitrary (possibly corrupt) selection into a valid one for the
 * given mode. Unknown ids fall back to the default. In local mode, duplicate
 * picks are auto-resolved to a different character unless `allowDuplicates`.
 *
 * @param {object} raw
 * @param {'ai'|'local'} mode
 * @param {{allowDuplicates?:boolean}} [opts]
 * @returns {{mode:'ai'|'local', playerOneCharacterId:string, playerTwoCharacterId:(string|null)}}
 */
export function normalizeSelection(raw, mode, opts = {}) {
  const allowDuplicates = !!opts.allowDuplicates;
  const m = mode === 'local' ? 'local' : 'ai';
  const out = {
    mode: m,
    playerOneCharacterId: coerceCharacterId(raw && raw.playerOneCharacterId),
    playerTwoCharacterId: null,
  };
  if (m === 'local') {
    let p2 = coerceCharacterId(raw && raw.playerTwoCharacterId);
    if (!allowDuplicates && p2 === out.playerOneCharacterId) {
      const alt = PLAYER_CHARACTERS.find((c) => c.id !== out.playerOneCharacterId);
      p2 = alt ? alt.id : p2;
    }
    out.playerTwoCharacterId = p2;
  }
  return out;
}

/**
 * Load + validate the saved selection. Corrupt/missing data falls back safely
 * to defaults. Never throws.
 * @param {Storage|{getItem:Function}} storage
 * @param {'ai'|'local'} mode
 * @param {{allowDuplicates?:boolean}} [opts]
 */
export function loadSelection(storage, mode, opts = {}) {
  let raw = null;
  try {
    const s = storage && storage.getItem(STORAGE_KEY);
    if (s) raw = JSON.parse(s);
  } catch (e) {
    raw = null; // corrupt JSON -> safe default
  }
  if (!raw || typeof raw !== 'object') raw = {};
  return normalizeSelection(raw, mode, opts);
}

/**
 * Persist the selection (ids only — no names or personal data). Never throws.
 * @param {Storage|{setItem:Function}} storage
 * @param {{playerOneCharacterId:string, playerTwoCharacterId:(string|null)}} selection
 * @returns {boolean} success
 */
export function saveSelection(storage, selection) {
  try {
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        playerOneCharacterId: selection.playerOneCharacterId,
        playerTwoCharacterId: selection.playerTwoCharacterId || null,
      }),
    );
    return true;
  } catch (e) {
    return false; // private mode / quota / disabled storage
  }
}

// Browser-only selection screen controller.

/**
 * Builds the character-selection screen and handles keyboard / pointer choice.
 */
export class CharacterSelect {
  /**
   * @param {object} els  DOM refs: { gridP1, gridP2, sideP2, opponent, oppAvatar,
   *   oppName, dupWrap, allowDup, live, confirm, back, p1Title, p2Title }
   * @param {object} handlers  { onConfirm(selection), onBack(), storage }
   */
  constructor(els, handlers = {}) {
    this.els = els;
    this.h = handlers;
    this.storage = handlers.storage || globalThis.localStorage;
    this.mode = 'ai';
    this.allowDuplicates = false;
    this.p1 = DEFAULT_CHARACTER_ID;
    this.p2 = null;
    this._built = false;
  }

  /** Build the two radio groups once. */
  build() {
    if (this._built) return;
    this._buildGroup(this.els.gridP1, 'p1');
    this._buildGroup(this.els.gridP2, 'p2');
    if (this.els.allowDup) {
      this.els.allowDup.addEventListener('change', () => {
        this.allowDuplicates = this.els.allowDup.checked;
        if (!this.allowDuplicates && this.mode === 'local' && this.p2 === this.p1) {
          const alt = PLAYER_CHARACTERS.find((c) => c.id !== this.p1);
          if (alt) this._pick('p2', alt.id, false);
        }
        this._refresh();
      });
    }
    if (this.els.confirm) this.els.confirm.addEventListener('click', () => this._confirm());
    if (this.els.back) this.els.back.addEventListener('click', () => this.h.onBack && this.h.onBack());
    this._built = true;
  }

  _buildGroup(grid, who) {
    if (!grid) return;
    grid.innerHTML = '';
    PLAYER_CHARACTERS.forEach((ch, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'char-card';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', 'false');
      b.dataset.id = ch.id;
      b.dataset.who = who;
      b.tabIndex = i === 0 ? 0 : -1;
      b.innerHTML =
        `<img class="character-avatar" src="${ch.avatar}" width="72" height="72" ` +
        `alt="Pixel-art avatar of ${ch.name}" ` +
        `onerror="this.classList.add('img-fail');this.replaceWith(Object.assign(document.createElement('span'),{className:'avatar-fallback',textContent:'${ch.name[0]}'}))" />` +
        `<span class="char-card-name">${ch.name}</span>` +
        `<span class="char-card-check" aria-hidden="true">\u2714</span>`;
      b.addEventListener('click', () => this._pick(who, ch.id, true));
      b.addEventListener('keydown', (e) => this._onKey(e, who, i));
      grid.appendChild(b);
    });
  }

  _cards(who) {
    const grid = who === 'p1' ? this.els.gridP1 : this.els.gridP2;
    return grid ? Array.from(grid.querySelectorAll('.char-card')) : [];
  }

  _onKey(e, who, idx) {
    const cards = this._cards(who);
    if (!cards.length) return;
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (idx + 1) % cards.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (idx - 1 + cards.length) % cards.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = cards.length - 1;
    else if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      this._pick(who, cards[idx].dataset.id, true);
      return;
    } else return;
    e.preventDefault();
    const id = cards[next].dataset.id;
    this._pick(who, id, true);
    cards[next].focus();
  }

  /** Select `id` for player `who` ('p1'|'p2'); enforce the duplicate guard. */
  _pick(who, id, announce) {
    if (who === 'p1') {
      this.p1 = id;
      if (this.mode === 'local' && !this.allowDuplicates && this.p2 === id) {
        const alt = PLAYER_CHARACTERS.find((c) => c.id !== id);
        this.p2 = alt ? alt.id : this.p2;
      }
    } else {
      if (this.mode === 'local' && !this.allowDuplicates && id === this.p1) {
        // reject duplicate: announce + keep previous
        this._say(`That character is already taken by Player One. Pick another.`);
        return;
      }
      this.p2 = id;
    }
    this._refresh();
    if (announce) {
      const ch = PLAYER_CHARACTERS.find((c) => c.id === id);
      const label = who === 'p1' ? (this.mode === 'local' ? 'Player One' : 'Player') : 'Player Two';
      if (ch) this._say(`${label}: ${ch.name} selected.`);
    }
  }

  _refresh() {
    const mark = (who, sel) => {
      this._cards(who).forEach((card) => {
        const on = card.dataset.id === sel;
        card.setAttribute('aria-checked', on ? 'true' : 'false');
        card.classList.toggle('selected', on);
        card.tabIndex = on ? 0 : -1;
        // also disable P1's pick inside P2 group when duplicates are off
        if (who === 'p2' && this.mode === 'local' && !this.allowDuplicates) {
          const dup = card.dataset.id === this.p1;
          card.classList.toggle('taken', dup);
          card.setAttribute('aria-disabled', dup ? 'true' : 'false');
        } else {
          card.classList.remove('taken');
          card.removeAttribute('aria-disabled');
        }
      });
    };
    // ensure at least one focusable per group even before a pick
    mark('p1', this.p1);
    if (this.mode === 'local') mark('p2', this.p2);
  }

  _say(msg) {
    if (this.els.live) this.els.live.textContent = msg;
  }

  _confirm() {
    const selection = {
      mode: this.mode,
      playerOneCharacterId: this.p1,
      playerTwoCharacterId: this.mode === 'local' ? this.p2 : null,
    };
    saveSelection(this.storage, selection);
    if (this.h.onConfirm) this.h.onConfirm(selection);
  }

  /**
   * Open the screen for a given mode, restoring the last saved (validated)
   * selection. Always leaves a clearly-shown default selected.
   * @param {'ai'|'local'} mode
   */
  open(mode) {
    this.build();
    this.mode = mode === 'local' ? 'local' : 'ai';
    this.allowDuplicates = !!(this.els.allowDup && this.els.allowDup.checked);
    const saved = loadSelection(this.storage, this.mode, { allowDuplicates: this.allowDuplicates });
    this.p1 = saved.playerOneCharacterId;
    this.p2 = this.mode === 'local' ? saved.playerTwoCharacterId : null;

    const isLocal = this.mode === 'local';
    if (this.els.sideP2) this.els.sideP2.hidden = !isLocal;
    if (this.els.dupWrap) this.els.dupWrap.hidden = !isLocal;
    if (this.els.opponent) this.els.opponent.hidden = isLocal;
    if (this.els.p1Title) this.els.p1Title.textContent = isLocal ? 'Player One' : 'You';
    if (!isLocal && this.els.oppAvatar) {
      this.els.oppAvatar.src = NPC_CHARACTERS.ai.avatar;
      this.els.oppAvatar.alt = `Pixel-art avatar of ${NPC_CHARACTERS.ai.name}`;
      if (this.els.oppName) this.els.oppName.textContent = `${NPC_CHARACTERS.ai.name} (AI)`;
    }
    this._refresh();
    // move focus to the currently-selected P1 card
    const sel = this._cards('p1').find((c) => c.dataset.id === this.p1);
    if (sel) setTimeout(() => sel.focus(), 30);
    this._say(isLocal ? 'Choose characters for Player One and Player Two.' : 'Choose your character.');
  }

  /** @returns current selection snapshot. */
  getSelection() {
    return {
      mode: this.mode,
      playerOneCharacterId: this.p1,
      playerTwoCharacterId: this.mode === 'local' ? this.p2 : null,
    };
  }
}
