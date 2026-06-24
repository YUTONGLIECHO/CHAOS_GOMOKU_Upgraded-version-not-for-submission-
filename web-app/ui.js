// ui.js
// Pixel-art UI layer (pure DOM). Knows the game state shape but nothing about
// Three.js. main.js wires the handlers and drives updates.

import { SKILLS, SKILL_BY_ID, PLAYER, AI, DIFFS } from './gameLogic.js';

// floating 3D text banks (used by main via effects.floatingText)
export const PLACE_TEXTS = ['BONK', 'TACTICAL DISC', 'VERY SERIOUS MOVE', 'CLACK', 'BOLD CHOICE', 'NOTED.'];
export const COMEDY_LINES = [
  'THE BOARD HAS CONTACTED HR.',
  'TACTICAL NONSENSE DETECTED.',
  'THIS MOVE IS PROBABLY LEGAL.',
  'A PROFESSIONAL WOULD NOT DO THAT.',
  'BIG BRAIN ACTIVITY.',
  'THE RULEBOOK HAS LEFT THE BUILDING.',
  'PHYSICS HAS FILED A COMPLAINT.',
  'THE CAMERA SAW EVERYTHING.',
];

const RESULT = {
  [PLAYER]: { title: 'MEAT COMPUTER WINS', sub: 'Humanity survives another firmware update.' },
  [AI]: { title: 'PROFESSOR BEEP-BOOP WINS', sub: 'You have been outsmarted by a glowing rectangle.' },
  draw: { title: 'NOBODY WINS', sub: 'The true winner was property damage.' },
};

const $ = (id) => document.getElementById(id);

// Skill icons drawn to match what the skill ACTUALLY looks like in the 3D game
// (effects.js props + palette): red meteor beam, gold tractor cone, the low-poly
// broom, blue ice crystals, an undo loop, gold swap arrows, the flipped table.
export const SKILL_ICON_SVG = {
  yeet: `<svg viewBox="0 0 32 32" aria-hidden="true">
    <polygon points="13,1 19,1 17.5,19 14.5,19" fill="#e8584a"/>
    <polygon points="14.3,1 17.7,1 16.6,14 15.4,14" fill="#ffd36b"/>
    <ellipse cx="16" cy="25" rx="7" ry="3.3" fill="#14101a" stroke="#46415e" stroke-width="1"/>
    <polygon points="16,20 13,24 19,24" fill="#e8584a"/>
    <rect x="8" y="28" width="2" height="3" fill="#e2b04a"/><rect x="22" y="28" width="2" height="3" fill="#e2b04a"/>
  </svg>`,
  finders: `<svg viewBox="0 0 32 32" aria-hidden="true">
    <polygon points="11,3 21,3 27,21 5,21" fill="#e2b04a" opacity="0.42"/>
    <polygon points="13.5,3 18.5,3 16,12 16,12" fill="#ffd36b" opacity="0.8"/>
    <ellipse cx="16" cy="20" rx="6.2" ry="3" fill="#ece0c8" stroke="#9a865f" stroke-width="1"/>
    <path d="M5 27 q11 6 22 0" fill="none" stroke="#e2b04a" stroke-width="1.4" stroke-dasharray="2 2"/>
  </svg>`,
  spring: `<svg viewBox="0 0 32 32" aria-hidden="true">
    <rect x="14.5" y="2" width="3" height="16" fill="#8a5a2c"/>
    <rect x="14.5" y="2" width="3" height="16" fill="none"/>
    <polygon points="9,18 23,18 25,29 7,29" fill="#e2b04a"/>
    <rect x="7" y="25" width="18" height="1.6" fill="#5c3a1c"/>
    <line x1="11" y1="20" x2="10" y2="29" stroke="#5c3a1c" stroke-width="1"/>
    <line x1="16" y1="20" x2="16" y2="29" stroke="#5c3a1c" stroke-width="1"/>
    <line x1="21" y1="20" x2="22" y2="29" stroke="#5c3a1c" stroke-width="1"/>
  </svg>`,
  zero: `<svg viewBox="0 0 32 32" aria-hidden="true">
    <polygon points="10,29 7.5,17 12.5,17" fill="#79c7e8"/>
    <polygon points="22,29 19,15 25,15" fill="#9fd8ff"/>
    <polygon points="16,30 12.5,9 19.5,9" fill="#cfeaff"/>
    <path d="M16 2 l1.1 3.4 3.4 1.1 -3.4 1.1 -1.1 3.4 -1.1 -3.4 -3.4 -1.1 3.4 -1.1z" fill="#eaffff"/>
  </svg>`,
  ctrlz: `<svg viewBox="0 0 32 32" aria-hidden="true">
    <path d="M10 17 a7 7 0 1 1 7 7" fill="none" stroke="#e2b04a" stroke-width="3"/>
    <polygon points="10,10 10,19 17,14.5" fill="#e2b04a"/>
    <ellipse cx="23" cy="9" rx="3" ry="1.6" fill="#ece0c8" opacity="0.5"/>
  </svg>`,
  corporate: `<svg viewBox="0 0 32 32" aria-hidden="true">
    <path d="M5 12 h14" stroke="#e2b04a" stroke-width="2.6" fill="none"/>
    <polygon points="19,8.5 26,12 19,15.5" fill="#e2b04a"/>
    <path d="M27 20 h-14" stroke="#caa23e" stroke-width="2.6" fill="none"/>
    <polygon points="13,16.5 6,20 13,23.5" fill="#caa23e"/>
  </svg>`,
  flip: `<svg viewBox="0 0 32 32" aria-hidden="true">
    <polygon points="3,25 19,17 29,21 13,29" fill="#8a5a2c" stroke="#5c3a1c" stroke-width="1"/>
    <circle cx="9" cy="8" r="2.6" fill="#14101a"/>
    <circle cx="18" cy="5" r="2.6" fill="#ece0c8"/>
    <circle cx="25" cy="11" r="2.2" fill="#14101a"/>
    <line x1="9" y1="12" x2="9" y2="15" stroke="#e2b04a" stroke-width="1"/>
    <line x1="18" y1="9" x2="18" y2="12" stroke="#e2b04a" stroke-width="1"/>
  </svg>`,
};
export const skillIconHTML = (id) => SKILL_ICON_SVG[id] || '';

export class UI {
  constructor(handlers) {
    this.h = handlers;
    this.el = {
      screens: {
        splash: $('splash-screen'), menu: $('menu-screen'), mode: $('mode-screen'), difficulty: $('difficulty-screen'),
        howto: $('howto-screen'), character: $('character-screen'), game: $('game-screen'),
      },
      turnLabel: $('turn-label'),
      statusMain: $('status-main'),
      statusSub: $('status-sub'),
      skillGrid: $('skill-grid'),
      skillTip: $('skill-tip'),
      endTurn: $('btn-end-turn'),
      cancelTarget: $('btn-cancel-target'),
      targetingBanner: $('targeting-banner'),
      aiSpeech: $('ai-speech'),
      portraitAI: document.querySelector('#portrait-ai .portrait-emoji'),
      portraitPlayer: document.querySelector('#portrait-player .portrait-emoji'),
      avatarAI: $('avatar-ai'),
      avatarPlayer: $('avatar-player'),
      resultAvatar: $('result-avatar'),
      panelAI: $('panel-ai'),
      panelPlayer: $('panel-player'),
      toast: $('toast'),
      diffDesc: $('diff-desc'),
      result: $('result-overlay'),
      resultTitle: $('result-title'),
      resultSub: $('result-subtitle'),
      debug: $('debug-panel'),
      btnSound: $('btn-sound'),
      btnReduced: $('btn-reduced'),
      btnHandoff: $('btn-handoff'),
      volume: $('volume'),
      btnSoundMenu: $('btn-sound-menu'),
      volumeMenu: $('volume-menu'),
      btnTutBack: $('btn-tut-back'),
      stockChart: $('stock-chart'),
      // dynamic panel fields
      playerName: $('player-name'), playerRole: $('player-role'),
      aiName: $('ai-name'), aiRole: $('ai-role'),
      playerReady: $('player-ready'), playerPips: $('player-pips'),
      playerStatus: $('player-status'), playerFrozen: $('player-frozen'),
      aiReady: $('ai-ready'), aiPips: $('ai-pips'),
      aiStatus: $('ai-status'), aiFrozen: $('ai-frozen'),
      // tutorial overlay
      tutorial: $('tutorial-overlay'), tutIcon: $('tut-icon'), tutTitle: $('tut-title'),
      tutText: $('tut-text'), tutDots: $('tut-dots'), btnTutNext: $('btn-tut-next'), btnTutSkip: $('btn-tut-skip'),
      // local handoff overlay
      handoff: $('handoff-overlay'), handoffDoneName: $('handoff-done-name'),
      handoffNextName: $('handoff-next-name'), handoffSub: $('handoff-sub'),
    };
    this._toastTimer = null;
    this._typer = null;
    this._wire();
  }

  _wire() {
    const h = this.h, el = this.el;
    const on = (node, ev, fn) => node && node.addEventListener(ev, fn);
    on($('btn-start'), 'click', () => h.onShowModes && h.onShowModes());
    on($('btn-howto'), 'click', () => h.onShowHowto && h.onShowHowto());
    // splash: any key / click / tap begins (but not when using the audio control)
    const splash = $('splash-screen');
    const fireSplash = (e) => {
      if (e && e.target && (e.target.id === 'volume-menu' || e.target.id === 'btn-sound-menu')) return;
      if (splash && splash.classList.contains('active')) h.onSplashStart && h.onSplashStart();
    };
    on(splash, 'pointerdown', fireSplash);
    window.addEventListener('keydown', fireSplash);
    on($('btn-howto-back'), 'click', () => h.onBackMenu && h.onBackMenu());
    // mode select
    on($('btn-mode-ai'), 'click', () => h.onModeAI && h.onModeAI());
    on($('btn-mode-local'), 'click', () => h.onModeLocal && h.onModeLocal());
    on($('btn-mode-back'), 'click', () => h.onBackMenu && h.onBackMenu());
    on($('btn-diff-back'), 'click', () => h.onBackModes && h.onBackModes());
    // difficulty buttons only (mode buttons use .mode-btn and are wired above)
    document.querySelectorAll('.diff-btn[data-diff]').forEach((b) => {
      on(b, 'click', () => h.onChooseDifficulty && h.onChooseDifficulty(b.dataset.diff));
      on(b, 'mouseenter', () => {
        if (el.diffDesc && DIFFS[b.dataset.diff]) {
          const d = DIFFS[b.dataset.diff];
          el.diffDesc.textContent = `${d.label}: ${d.desc}`;
        }
      });
    });
    on(el.endTurn, 'click', () => h.onEndTurn && h.onEndTurn());
    on(el.cancelTarget, 'click', () => h.onCancelTarget && h.onCancelTarget());
    on($('btn-reset-cam'), 'click', () => h.onResetCamera && h.onResetCamera());
    on($('btn-restart'), 'click', () => h.onRestart && h.onRestart());
    on($('btn-mainmenu'), 'click', () => h.onMainMenu && h.onMainMenu());
    on($('btn-result-rematch'), 'click', () => h.onRestart && h.onRestart());
    on($('btn-result-menu'), 'click', () => h.onMainMenu && h.onMainMenu());
    on(el.btnSound, 'click', () => h.onToggleSound && h.onToggleSound());
    on(el.btnReduced, 'click', () => h.onToggleReduced && h.onToggleReduced());
    on(el.btnHandoff, 'click', () => h.onToggleHandoff && h.onToggleHandoff());
    on(el.volume, 'input', () => h.onVolume && h.onVolume(parseFloat(el.volume.value)));
    on(el.btnSoundMenu, 'click', () => h.onToggleSound && h.onToggleSound());
    on(el.volumeMenu, 'input', () => h.onVolume && h.onVolume(parseFloat(el.volumeMenu.value)));
    on(el.btnTutNext, 'click', () => h.onTutNext && h.onTutNext());
    on(el.btnTutBack, 'click', () => h.onTutBack && h.onTutBack());
    on(el.btnTutSkip, 'click', () => h.onTutSkip && h.onTutSkip());
  }

  showScreen(name) {
    for (const k in this.el.screens) {
      const s = this.el.screens[k];
      if (s) s.classList.toggle('active', k === name);
    }
    document.body.setAttribute('data-screen', name);
  }

  setSoundButton(on) {
    const t = on ? 'AUDIO: ON' : 'AUDIO: OFF';
    if (this.el.btnSound) this.el.btnSound.textContent = t;
    if (this.el.btnSoundMenu) this.el.btnSoundMenu.textContent = t;
  }
  setReducedButton(on) { if (this.el.btnReduced) { this.el.btnReduced.textContent = on ? 'MOTION: REDUCED' : 'MOTION: FULL'; this.el.btnReduced.setAttribute('aria-pressed', on ? 'true' : 'false'); } }
  setVolume(v) { if (this.el.volume) this.el.volume.value = v; if (this.el.volumeMenu) this.el.volumeMenu.value = v; }

  // ---- skill tray -----------------------------------------------------------
  renderSkills(game, opts = {}) {
    const grid = this.el.skillGrid; if (!grid) return;
    grid.innerHTML = '';
    const side = opts.side || PLAYER;     // whose tray to show (active human in local mode)
    const frozen = game.frozen[side];
    for (const def of SKILLS) {
      const card = document.createElement('button');
      card.className = 'skill-card';
      card.dataset.skill = def.id;
      card.type = 'button';

      // work out the card's state (truthful to the existing cooldown/once model)
      let state, stateText, badge;
      if (def.cd === 'once') { badge = 'ONCE'; } else { badge = 'CD ' + def.cd; }
      const ready = game.skillReady(side, def.id);
      const undoBlocked = def.id === 'ctrlz' && !game.canUndo(side);

      if (def.cd === 'once' && game.usedOnce[side][def.id]) { state = 'used'; stateText = 'Used'; }
      else if (def.cd !== 'once' && (game.cooldowns[side][def.id] || 0) > 0) { state = 'cooldown'; stateText = 'Cooldown: ' + game.cooldowns[side][def.id]; }
      else if (frozen) { state = 'frozen'; stateText = 'Frozen'; }
      else if (undoBlocked) { state = 'unavailable'; stateText = 'Nothing to undo'; }
      else { state = 'ready'; stateText = (def.cd === 'once') ? 'Ready · once per game' : 'Ready'; }

      const selected = opts.selecting === def.id;
      const usable = game.canUseSkillNow(side) && ready && !undoBlocked && !frozen;
      card.classList.add('st-' + state);
      if (selected) card.classList.add('selecting');
      if (!usable) card.classList.add('disabled');
      card.setAttribute('aria-disabled', usable ? 'false' : 'true');

      const iconHtml = (this._skillIcons && this._skillIcons[def.id])
        ? `<img class="sk-img" src="${this._skillIcons[def.id]}" alt="">`
        : (SKILL_ICON_SVG[def.id] || def.icon);
      card.innerHTML =
        `<span class="sk-badge">${badge}</span>` +
        `<span class="sk-icon">${iconHtml}</span>` +
        `<span class="sk-body">` +
          `<span class="sk-name">${def.name}</span>` +
          `<span class="sk-desc">${def.desc}</span>` +
          `<span class="sk-state">${selected ? 'Selected — pick a target' : stateText}</span>` +
        `</span>`;

      const tip = `${def.name}\n${def.desc}\n${stateText}`;
      const show = () => this._showTip(card, tip);
      const hide = () => this._hideTip();
      card.addEventListener('mouseenter', show);
      card.addEventListener('focus', show);
      card.addEventListener('mouseleave', hide);
      card.addEventListener('blur', hide);
      card.addEventListener('click', () => {
        this._hideTip();
        if (!card.classList.contains('disabled')) this.h.onSkill && this.h.onSkill(def.id);
      });
      grid.appendChild(card);
    }
  }

  // Shared tooltip kept OUTSIDE the scrolling tray so it can't be clipped, and
  // clamped to the viewport. Works on hover, keyboard focus, and tap-focus.
  _showTip(card, text) {
    const tip = this.el.skillTip; if (!tip) return;
    tip.innerHTML = text.split('\n').map((l, i) => `<span class="${i === 0 ? 'tip-title' : 'tip-line'}">${l}</span>`).join('');
    tip.classList.add('show');
    const cr = card.getBoundingClientRect();
    const tr = tip.getBoundingClientRect();
    let left = cr.left + cr.width / 2 - tr.width / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - tr.width - 8));
    let top = cr.top - tr.height - 10;
    if (top < 8) top = cr.bottom + 10;   // not enough room above -> show below
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
  }
  _hideTip() { if (this.el.skillTip) this.el.skillTip.classList.remove('show'); }

  // ---- turn / status --------------------------------------------------------
  // Two-level status: a large main line + a smaller instruction line. State is
  // conveyed by text (and an optional state class), not by color alone.
  setStatus(main, sub = '', state = '') {
    if (this.el.statusMain) this.el.statusMain.textContent = main;
    if (this.el.statusSub) this.el.statusSub.textContent = sub;
    if (this.el.turnLabel) this.el.turnLabel.className = 'turn-label' + (state ? ' state-' + state : '');
  }
  // End Turn changes label by phase and is disabled when ending isn't allowed.
  setEndTurn(label, enabled) {
    if (!this.el.endTurn) return;
    this.el.endTurn.textContent = label;
    this.el.endTurn.disabled = !enabled;
  }

  // Fill both side panels with useful, truthful info derived from game state.
  // Note: the game uses a cooldown / once-per-game model (no energy resource),
  // so the meter shows how many skills are currently READY rather than an
  // invented energy value.
  updatePanels(game, opts = {}) {
    const total = SKILLS.length;
    const countReady = (side) => SKILLS.reduce((n, s) => n + (game.skillReady(side, s.id) &&
      !(s.id === 'ctrlz' && !game.canUndo(side)) ? 1 : 0), 0);
    const pips = (lit) => {
      let h = '';
      for (let i = 0; i < total; i++) h += `<span class="pip${i < lit ? ' lit' : ''}"></span>`;
      return h;
    };
    const rp = countReady(PLAYER), ra = countReady(AI);
    if (this.el.playerPips) this.el.playerPips.innerHTML = pips(rp);
    if (this.el.aiPips) this.el.aiPips.innerHTML = pips(ra);
    if (this.el.playerReady) this.el.playerReady.textContent = rp + '/' + total;
    if (this.el.aiReady) this.el.aiReady.textContent = ra + '/' + total;
    if (this.el.playerStatus) this.el.playerStatus.textContent = opts.playerStatus || (
      game.frozen[PLAYER] ? 'Frozen — skills locked'
      : opts.mode === 'local' ? (game.current === PLAYER ? 'Your move, allegedly' : 'Standing by, judging')
      : 'Operational, regrettably');
    if (this.el.aiStatus) this.el.aiStatus.textContent = opts.aiStatus || (
      game.frozen[AI] ? 'Frozen — skills locked'
      : opts.mode === 'local' ? (game.current === AI ? 'Your move, allegedly' : 'Standing by, judging')
      : 'Plotting quietly');
    if (this.el.playerFrozen) this.el.playerFrozen.classList.toggle('show', game.frozen[PLAYER]);
    if (this.el.aiFrozen) this.el.aiFrozen.classList.toggle('show', game.frozen[AI]);
  }

  // Apply per-mode static labels (names, roles, portraits) + body class.
  setMode(mode) {
    const local = mode === 'local';
    document.body.classList.toggle('local', local);
    document.body.classList.toggle('mode-ai', !local);
    const set = (el, t) => { if (el) el.textContent = t; };
    set(this.el.playerName, local ? 'PLAYER ONE' : 'LOCAL MEAT COMPUTER');
    set(this.el.playerRole, local ? 'Black · Organic Participant' : 'Black · You');
    set(this.el.aiName, local ? 'PLAYER TWO' : 'PROFESSOR BEEP-BOOP');
    set(this.el.aiRole, local ? 'White · Also Organic' : 'White · AI');
    set(this.el.portraitPlayer, local ? '⚫' : '🧠');
    set(this.el.portraitAI, local ? '⚪' : '🤖');
    if (!local && this.el.aiSpeech) this.el.aiSpeech.classList.remove('show');
  }

  // ---- HUD avatars ----------------------------------------------------------
  // Show a chosen character avatar in a side panel; falls back to the emoji
  // portrait if the image is missing or fails to load.
  setAvatar(side, url, name) {
    const img = side === 'ai' ? this.el.avatarAI : this.el.avatarPlayer;
    const emoji = side === 'ai' ? this.el.portraitAI : this.el.portraitPlayer;
    if (!img) return;
    if (!url) { img.hidden = true; img.removeAttribute('src'); if (emoji) emoji.style.display = ''; return; }
    img.onerror = () => { img.hidden = true; if (emoji) emoji.style.display = ''; };
    img.onload = () => { img.hidden = false; if (emoji) emoji.style.display = 'none'; };
    img.alt = name ? `Pixel-art avatar of ${name}` : '';
    img.src = url;
  }

  clearAvatars() {
    for (const [img, emoji] of [[this.el.avatarPlayer, this.el.portraitPlayer], [this.el.avatarAI, this.el.portraitAI]]) {
      if (img) { img.hidden = true; img.removeAttribute('src'); }
      if (emoji) emoji.style.display = '';
    }
  }

  setResultAvatar(url, name) {
    const img = this.el.resultAvatar;
    if (!img) return;
    if (!url) { img.hidden = true; img.removeAttribute('src'); return; }
    img.onerror = () => { img.hidden = true; };
    img.alt = name ? `Pixel-art avatar of ${name}` : '';
    img.hidden = false;
    img.src = url;
  }

  setIdentity(side, name) {
    const el = side === 'ai' ? this.el.aiName : this.el.playerName;
    if (el && name) el.textContent = name;
  }

  setHandoffButton(on) { if (this.el.btnHandoff) this.el.btnHandoff.textContent = on ? 'HANDOFF: ON' : 'HANDOFF: OFF'; }

  // Local 2-player turn handoff: a short STATIC banner showing both the player
  // who just finished and the one taking over, side by side (no fast text
  // swap). Calls opts.done() when finished. Reduced-motion just shortens it.
  playHandoff(completeName, nextName, opts = {}) {
    const el = this.el.handoff;
    if (!el) { if (opts.done) opts.done(); return; }
    const dur = opts.reduced ? 420 : 900;
    if (this.el.handoffDoneName) this.el.handoffDoneName.textContent = completeName;
    if (this.el.handoffNextName) this.el.handoffNextName.textContent = nextName;
    el.classList.add('show'); el.classList.toggle('reduced', !!opts.reduced);
    clearTimeout(this._hoT2);
    this._hoT2 = setTimeout(() => { this._hoT2 = null; el.classList.remove('show'); if (opts.done) opts.done(); }, dur);
  }
  hideHandoff() {
    clearTimeout(this._hoT2);
    this._hoT2 = null;
    if (this.el.handoff) this.el.handoff.classList.remove('show');
  }
  setEndTurnEnabled(on) { if (this.el.endTurn) this.el.endTurn.disabled = !on; } // kept for safety

  setThinking(on, msg) {
    if (this.el.portraitAI) this.el.portraitAI.classList.toggle('thinking', on);
    if (this.el.aiSpeech) {
      if (on && msg) { this.el.aiSpeech.textContent = msg; this.el.aiSpeech.classList.add('show'); }
      else if (!on) this.el.aiSpeech.classList.remove('show');
    }
  }
  aiSay(msg) {
    if (!this.el.aiSpeech) return;
    this.el.aiSpeech.textContent = msg;
    this.el.aiSpeech.classList.add('show');
    clearTimeout(this._sayTimer);
    this._sayTimer = setTimeout(() => { this._sayTimer = null; this.el.aiSpeech.classList.remove('show'); }, 2600);
  }

  setFrozen(side, on) {
    const panel = side === AI ? this.el.panelAI : this.el.panelPlayer;
    const portrait = side === AI ? this.el.portraitAI : this.el.portraitPlayer;
    if (panel) panel.classList.toggle('frozen', on);
    if (portrait) portrait.classList.toggle('frozen', on);
  }

  setActiveSide(side) {
    if (this.el.panelPlayer) this.el.panelPlayer.classList.toggle('active', side === PLAYER);
    if (this.el.panelAI) this.el.panelAI.classList.toggle('active', side === AI);
  }

  // ---- targeting ------------------------------------------------------------
  showTargeting(on) {
    if (this.el.targetingBanner) this.el.targetingBanner.classList.toggle('show', on);
    if (this.el.cancelTarget) this.el.cancelTarget.classList.toggle('show', on);
    document.body.classList.toggle('targeting', on);
  }

  // ---- toasts & comedy ------------------------------------------------------
  toast(msg) {
    const t = this.el.toast; if (!t) return;
    t.textContent = msg; t.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => { this._toastTimer = null; t.classList.remove('show'); }, 2200);
  }

  comedyPopup() {
    const host = this.el.screens.game; if (!host) return;
    const div = document.createElement('div');
    div.className = 'comedy-pop';
    div.textContent = COMEDY_LINES[(Math.random() * COMEDY_LINES.length) | 0];
    div.style.left = (12 + Math.random() * 50) + '%';
    div.style.top = (16 + Math.random() * 30) + '%';
    host.appendChild(div);
    setTimeout(() => div.classList.add('go'), 20);
    setTimeout(() => div.remove(), 2400);
  }

  flashStockChart() {
    const c = this.el.stockChart; if (!c) return;
    c.classList.add('show');
    setTimeout(() => c.classList.remove('show'), 1600);
  }

  // ---- result ---------------------------------------------------------------
  showResult(winner, mode) {
    const local = mode === 'local';
    const LOCAL = {
      [PLAYER]: { title: 'PLAYER ONE WINS', sub: 'A household dispute has reached a formal conclusion.' },
      [AI]: { title: 'PLAYER TWO WINS', sub: 'The device has selected a new favorite.' },
      draw: { title: 'NOBODY WINS', sub: 'The true winner was furniture tension.' },
    };
    const r = (local ? LOCAL : RESULT)[winner] || (local ? LOCAL : RESULT).draw;
    if (this.el.resultTitle) this.el.resultTitle.textContent = r.title;
    if (this.el.resultSub) this.el.resultSub.textContent = r.sub;
    if (this.el.result) this.el.result.classList.add('show');
  }
  hideResult() { if (this.el.result) this.el.result.classList.remove('show'); }

  // ---- debug ----------------------------------------------------------------
  setDebug(enabled) { if (this.el.debug) this.el.debug.classList.toggle('show', enabled); }
  debug(lines) {
    if (!this.el.debug) return;
    this.el.debug.innerHTML = lines.map((l) => `<div>${l}</div>`).join('');
  }

  // ---- interactive tutorial -------------------------------------------------
  showTutorial(on) {
    if (this.el.tutorial) this.el.tutorial.classList.toggle('show', on);
    document.body.classList.toggle('tutorial', on);
    if (!on) this.stopTyping();
  }
  setTutorialHead(icon, title) {
    if (this.el.tutIcon) this.el.tutIcon.innerHTML = icon;
    if (this.el.tutTitle) this.el.tutTitle.textContent = title;
  }
  skillIcon(id) {
    if (this._skillIcons && this._skillIcons[id]) return `<img class="sk-img" src="${this._skillIcons[id]}" alt="">`;
    return SKILL_ICON_SVG[id] || '';
  }
  setSkillIcons(map) { this._skillIcons = map || {}; }
  setTutorialDots(total, idx) {
    if (!this.el.tutDots) return;
    let h = '';
    for (let i = 0; i < total; i++) h += `<span class="tut-dot${i === idx ? ' on' : ''}"></span>`;
    this.el.tutDots.innerHTML = h;
  }
  setTutNextLabel(label) { if (this.el.btnTutNext) this.el.btnTutNext.textContent = label; }
  setTutBack(enabled) { if (this.el.btnTutBack) { this.el.btnTutBack.disabled = !enabled; this.el.btnTutBack.style.visibility = enabled ? 'visible' : 'hidden'; } }

  // Typewriter reveal with an optional per-tick callback (used for sound).
  // Returns immediately; call finishTyping() to complete instantly.
  typewriter(text, opts = {}) {
    this.stopTyping();
    const el = this.el.tutText; if (!el) { if (opts.onDone) opts.onDone(); return; }
    el.textContent = '';
    let i = 0;
    const speed = opts.speed || 26;
    this._typeDone = opts.onDone || null;
    this._typeText = text;
    this._typer = setInterval(() => {
      i++;
      el.textContent = text.slice(0, i);
      if (opts.onTick && i % 2 === 0) opts.onTick(i);
      if (i >= text.length) this._finishTypingInternal();
    }, speed);
  }
  _finishTypingInternal() {
    if (this._typer) { clearInterval(this._typer); this._typer = null; }
    if (this.el.tutText && this._typeText != null) this.el.tutText.textContent = this._typeText;
    const cb = this._typeDone; this._typeDone = null; this._typeText = null;
    if (cb) cb();
  }
  finishTyping() { if (this._typer) this._finishTypingInternal(); }
  stopTyping() { if (this._typer) { clearInterval(this._typer); this._typer = null; } this._typeDone = null; this._typeText = null; }
  isTyping() { return !!this._typer; }
}
