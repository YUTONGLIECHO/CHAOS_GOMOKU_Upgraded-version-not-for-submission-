// Intro/tutorial overlay for Player vs AI.
// It can be skipped; timers/listeners are tracked so cleanup stays safe.

const ABORT = Symbol('intro-abort');
const DONE_KEY = 'cg3d_intro_done';

export class IntroSequence {
  constructor(ctx) {
    this.ctx = ctx;                 // host bridge (see main.js _introCtx())
    this.reduced = false;
    this._running = false;
    const $ = (id) => document.getElementById(id);
    this.els = {
      overlay: $('intro-overlay'), skip: $('intro-skip'),
      boot: $('intro-boot'), bootText: $('intro-boot-text'),
      ackWrap: $('intro-ack-wrap'), ack: $('intro-ack'),
      sys: $('intro-sys'), card: $('intro-card'),
      speech: $('intro-speech'), speaker: $('intro-speaker'), speechText: $('intro-speech-text'),
      rule: $('intro-rule'), ruleTitle: $('intro-rule-title'), ruleBody: $('intro-rule-body'), stamp: $('intro-stamp'),
      prompt: $('intro-prompt'), cta: $('intro-cta'), choices: $('intro-choices'), flash: $('intro-flash'),
    };
    // the skip button is wired exactly once, for the lifetime of the page
    if (this.els.skip) this.els.skip.addEventListener('click', () => this.skip());
  }

  isDone() { try { return localStorage.getItem(DONE_KEY) === '1'; } catch (e) { return false; } }
  markDone() { try { localStorage.setItem(DONE_KEY, '1'); } catch (e) {} }

  // ---- lifecycle -----------------------------------------------------------
  async run({ reduced = false, onComplete = null } = {}) {
    if (this._running) return;        // never run twice concurrently
    this._running = true;
    this._finished = false;
    this._abort = false;
    this.reduced = reduced;
    this.onComplete = onComplete;
    this._timers = new Set();
    this._listeners = [];
    this._rejecters = [];

    this._resetEls();
    if (this.els.overlay) this.els.overlay.classList.add('show');

    try {
      await this._boot();              // STAGE 1 BOOT + ACKNOWLEDGEMENT
      await this._boardReveal();       // STAGE 2 BOARD_REVEAL
      await this._cameraTutorial();    // STAGE 3 CAMERA_TUTORIAL
      await this._aiIntro();           // STAGE 4 AI_INTRO
      await this._playerResponse();    // STAGE 5 PLAYER_RESPONSE
      await this._placementTutorial(); // STAGE 6 PLACEMENT_TUTORIAL
      await this._ruleReveal();        // STAGE 7 RULE_REVEAL
      await this._chaosPreview();      // STAGE 8 CHAOS_PREVIEW
      await this._ready();             // STAGE 9 READY
      this._finish(false);             // COMPLETE
    } catch (e) {
      if (e !== ABORT) console.error('[intro] error:', e);
      this._finish(true);              // any error -> behave like a clean skip
    }
  }

  skip() {
    if (!this._running || this._abort) return;
    this._abort = true;
    this._flushRejecters();            // unblock whatever stage is awaiting
  }

  _finish(skipped) {
    if (this._finished) return;
    this._finished = true;
    this._cleanup();
    this.markDone();
    this._running = false;
    const cb = this.onComplete; this.onComplete = null;
    if (cb) cb({ skipped });
  }

  _cleanup() {
    this._abort = true;
    this._flushRejecters();
    for (const id of this._timers) { clearTimeout(id); clearInterval(id); }
    this._timers.clear();
    for (const off of this._listeners) { try { off(); } catch (e) {} }
    this._listeners = [];
    this.ctx.cleanupDummies();                 // remove preview meshes
    this.ctx.boardGroup.rotation.set(0, 0, 0); // undo any tilt
    this._restoreStars();
    this._resetEls();
    if (this.els.overlay) this.els.overlay.classList.remove('show');
  }

  // ---- abortable primitives ------------------------------------------------
  _flushRejecters() { const rs = this._rejecters; this._rejecters = []; for (const r of rs) { try { r(); } catch (e) {} } }
  // race any host promise (fx.tween / fx.delay / placement) against abort
  _abortable(promise) {
    return Promise.race([
      promise,
      new Promise((_, rej) => { if (this._abort) rej(ABORT); else this._rejecters.push(() => rej(ABORT)); }),
    ]);
  }
  _sleep(ms) { return this._abortable(this.ctx.fx.delay(this._scale(ms))); }
  _scale(ms) { return this.reduced ? Math.max(60, Math.round(ms * 0.4)) : ms; }

  // append-type a line into a <pre> (boot terminal); resolves when finished
  _appendType(pre, line) {
    return new Promise((res, rej) => {
      if (this._abort) return rej(ABORT);
      const base = pre.textContent;
      let i = 0; const speed = this.reduced ? 3 : 20;
      const t = setInterval(() => {
        i++; pre.textContent = base + line.slice(0, i);
        if (i % 2 === 0) this.ctx.sound.play('type');
        if (i >= line.length) { clearInterval(t); this._timers.delete(t); pre.textContent = base + line + '\n'; res(); }
      }, speed);
      this._timers.add(t);
      this._rejecters.push(() => { clearInterval(t); this._timers.delete(t); rej(ABORT); });
    });
  }
  // typewriter into a normal element
  _type(el, text, opts = {}) {
    return new Promise((res, rej) => {
      if (this._abort) return rej(ABORT);
      el.textContent = ''; let i = 0; const speed = this.reduced ? 5 : (opts.speed || 28);
      const t = setInterval(() => {
        i++; el.textContent = text.slice(0, i);
        if (opts.sound && i % 2 === 0) this.ctx.sound.play('type');
        if (i >= text.length) { clearInterval(t); this._timers.delete(t); el.textContent = text; res(); }
      }, speed);
      this._timers.add(t);
      this._rejecters.push(() => { clearInterval(t); this._timers.delete(t); rej(ABORT); });
    });
  }
  _waitClick(btn) {
    return new Promise((res, rej) => {
      if (this._abort) return rej(ABORT);
      const h = () => { off(); res(); };
      const off = () => btn.removeEventListener('click', h);
      btn.addEventListener('click', h);
      this._listeners.push(off);
      this._rejecters.push(() => { off(); rej(ABORT); });
    });
  }
  // resolve once the player rotates the camera past a threshold (with a
  // generous fallback so nobody can get soft-locked)
  _waitCamera() {
    return new Promise((res, rej) => {
      if (this._abort) return rej(ABORT);
      const c = this.ctx.controls;
      const a0 = c.getAzimuthalAngle(), p0 = c.getPolarAngle();
      const h = () => {
        const d = Math.abs(c.getAzimuthalAngle() - a0) + Math.abs(c.getPolarAngle() - p0);
        if (d > 0.18) { done(); res(); }
      };
      const id = setTimeout(() => { done(); res(); }, this.reduced ? 4000 : 9000);
      this._timers.add(id);
      const done = () => { c.removeEventListener('change', h); clearTimeout(id); this._timers.delete(id); };
      c.addEventListener('change', h);
      this._listeners.push(done);
      this._rejecters.push(() => { done(); rej(ABORT); });
    });
  }
  _choices(options) {
    const wrap = this.els.choices; wrap.innerHTML = '';
    return new Promise((res, rej) => {
      if (this._abort) return rej(ABORT);
      const offs = [];
      options.forEach((label, idx) => {
        const b = document.createElement('button');
        b.className = 'intro-choice'; b.type = 'button'; b.textContent = (idx + 1) + '. ' + label;
        const h = () => { this.ctx.sound.play('click'); cleanup(); res(idx); };
        b.addEventListener('click', h); wrap.appendChild(b);
        offs.push(() => b.removeEventListener('click', h));
      });
      this._showEl('choices', true);
      const cleanup = () => { offs.forEach((f) => f()); this._showEl('choices', false); wrap.innerHTML = ''; };
      this._listeners.push(cleanup);
      this._rejecters.push(() => { cleanup(); rej(ABORT); });
    });
  }
  async _cta(label, sub) {
    const wrap = this.els.cta; wrap.innerHTML = '';
    const b = document.createElement('button'); b.className = 'intro-btn'; b.type = 'button'; b.textContent = label;
    wrap.appendChild(b);
    if (sub) { const s = document.createElement('small'); s.textContent = sub; wrap.appendChild(s); }
    this._showEl('cta', true);
    await this._waitClick(b);
    this.ctx.sound.play('click');
    this._showEl('cta', false); wrap.innerHTML = '';
  }

  // ---- small UI helpers ----------------------------------------------------
  _showEl(key, on) { const el = this.els[key]; if (el) el.classList.toggle('show', !!on); }
  _showPrompt(main, sub) {
    if (!this.els.prompt) return;
    this.els.prompt.innerHTML = this._esc(main) + (sub ? `<small>${this._esc(sub)}</small>` : '');
    this._showEl('prompt', true);
  }
  _hidePrompt() { this._showEl('prompt', false); }
  _flash(text) {
    const el = this.els.flash; if (!el) return;
    el.textContent = text; el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  }
  _esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  async _say(text) {
    this.els.speaker.textContent = 'PROFESSOR BEEP-BOOP';
    this._showEl('speech', true);
    await this._type(this.els.speechText, text, { sound: true });
    await this._sleep(420);
  }
  async _sys(text, hold = 700) {
    this._showEl('sys', true);
    await this._type(this.els.sys, text, { sound: false });
    await this._sleep(hold);
  }
  _pulseStars() {
    const dots = this.ctx.starDots || [];
    dots.forEach((d) => d.scale.setScalar(0.2));
    this.ctx.fx.tween({
      duration: this.reduced ? 220 : 800,
      onUpdate: (p) => { if (this._abort) return; const s = 0.2 + 0.8 * p + Math.sin(p * Math.PI) * 0.7; dots.forEach((d) => d.scale.setScalar(s)); },
      onComplete: () => dots.forEach((d) => d.scale.setScalar(1)),
    });
  }
  _restoreStars() { (this.ctx.starDots || []).forEach((d) => d.scale.setScalar(1)); }
  async _cameraTo(pos, target, dur) {
    const ctx = this.ctx;
    const fromP = ctx.camera.position.clone();
    const fromT = ctx.controls.target.clone();
    await this._abortable(ctx.fx.tween({
      duration: this.reduced ? Math.min(dur, 280) : dur,
      onUpdate: (p) => {
        if (this._abort) return;
        ctx.camera.position.lerpVectors(fromP, pos, p);
        ctx.controls.target.lerpVectors(fromT, target, p);
        ctx.controls.update();
      },
    }));
  }

  // ---- STAGES --------------------------------------------------------------
  async _boot() {
    this.ctx.setControlsEnabled(false);
    this._showEl('boot', true);
    this.ctx.sound.play('boot');
    const pre = this.els.bootText; pre.textContent = '';
    const lines = [
      'Initializing competitive environment...',
      'Loading rules...',
      'Loading additional rules...',
      'Loading exceptions to the additional rules...',
      'Loading legal defense team...',
      'Attempting to locate fairness...',
    ];
    for (const ln of lines) { await this._appendType(pre, ln); await this._sleep(220); }
    await this._sleep(700);
    this.ctx.sound.play('warn');
    await this._appendType(pre, 'Fairness not found.');
    await this._appendType(pre, 'Continuing anyway.');
    this._showEl('ackWrap', true);
    await this._waitClick(this.els.ack);
    this.ctx.sound.play('click');
  }

  async _boardReveal() {
    const ctx = this.ctx;
    this._showEl('boot', false);
    if (!this.reduced) {
      const P = ctx.CAMERA_PRESET;
      const low = new ctx.THREE.Vector3(P.position.x * 0.45, 2.6, P.position.z * 1.2);
      ctx.camera.position.copy(low);
      ctx.controls.target.set(0, 0, 0); ctx.controls.update();
      this._pulseStars();
      ctx.sound.play('grid');
      await this._cameraTo(P.position, P.target, 1700);
    } else {
      ctx.camera.position.copy(ctx.CAMERA_PRESET.position);
      ctx.controls.target.copy(ctx.CAMERA_PRESET.target); ctx.controls.update();
      this._restoreStars();
      await this._sleep(160);
    }
    await this._sys('Welcome, Temporary Human Asset.', 850);
    await this._sys('You have been selected for mandatory recreational testing.', 850);
    this._showEl('card', true);
    await this._sleep(900);
  }

  async _cameraTutorial() {
    this.ctx.setControlsEnabled(true);
    this._showPrompt('DRAG TO INSPECT YOUR WORKPLACE', 'Mouse: left-drag · Trackpad: one-finger drag · Touch: one finger');
    await this._waitCamera();
    this._hidePrompt();
    await this._sys('Camera movement detected.\nMotor skills remain operational.\nPromising.', 1000);
  }

  async _aiIntro() {
    this._showEl('card', false);
    this.ctx.setControlsEnabled(false);
    this.ctx.sound.play('glitch');
    await this._say('Oh.\nThey sent a human.');
    await this._sleep(300);
    await this._say('I was told this would be a controlled experiment.');
    await this._sys('It is controlled.', 650);
    await this._say('By whom?');
    await this._sleep(900);                       // the system does not answer
  }

  async _playerResponse() {
    const idx = await this._choices([
      'I know how to play Gomoku.',
      'I clicked the wrong link.',
      'Can I leave?',
    ]);
    const reply = [
      'Excellent.\nThat knowledge will become obsolete shortly.',
      'That is also how I was hired.',
      'Of course.',
    ][idx];
    await this._say(reply);
    if (idx === 2) {
      await this._sleep(450);
      this.ctx.sound.play('warn');
      this._flash('EXIT REQUEST DENIED');
      await this._sleep(1200);
    }
  }

  async _placementTutorial() {
    const ctx = this.ctx; const W = (r, c) => ctx.boardToWorld(r, c);
    this._showEl('speech', false);
    this._showEl('card', false);
    ctx.setControlsEnabled(false);
    ctx.pulseCenters();
    this._showPrompt('A piece is placed on an empty intersection.', 'In a real match you tap to place — try not to make it legally complicated.');
    await this._sleep(700);
    const d1 = ctx.spawnDummy(7, 7, 1);
    await this._abortable(ctx.fx.dropPiece(d1, W(7, 7)));
    this._hidePrompt();
    await this._say('A black disc.\nBold.\nHistorically unprecedented.');
    const d2 = ctx.spawnDummy(7, 8, 2);
    await this._abortable(ctx.fx.dropPiece(d2, W(7, 8)));
    await this._say('Observe.\nA superior disc.');
  }

  async _ruleReveal() {
    this._showEl('speech', false);
    this.els.ruleTitle.textContent = 'STANDARD OBJECTIVE';
    this.els.ruleBody.textContent = 'Connect five pieces in a row.';
    this._showEl('rule', true);
    await this._sleep(850);
    this.els.stamp.classList.add('show');
    this.ctx.sound.play('warn');
    await this._sleep(1100);
    this._showEl('rule', false);
    this.els.stamp.classList.remove('show');
  }

  async _chaosPreview() {
    const ctx = this.ctx; const W = (r, c) => ctx.boardToWorld(r, c);
    await this._sys('To improve strategic depth, authorized participants may now use—', 450);
    ctx.sound.play('warn');
    // brief, self-contained demos on throwaway meshes (real board untouched)
    let d = ctx.spawnDummy(5, 5, 1); ctx.sound.play('explosion');
    await this._abortable(ctx.fx.yeetMeteor(d)); ctx.removeMesh(d);
    d = ctx.spawnDummy(9, 6, 2);
    await this._abortable(ctx.fx.findersKeepers(d, W(9, 9))); ctx.removeMesh(d);
    ctx.sound.play('ice');
    await this._abortable(ctx.fx.absoluteZero(W(5, 9)));
    ctx.ui.flashStockChart();
    await this._sleep(450);
    if (!this.reduced) await this._tiltBoard();
    await this._sleep(250);
    await this._sys('These features are functioning within acceptable parameters.', 800);
    await this._say('Define acceptable.');
    await this._sys('No.', 650);
  }

  async _tiltBoard() {
    const g = this.ctx.boardGroup;
    await this._abortable(this.ctx.fx.tween({
      duration: 320,
      onUpdate: (p) => { if (this._abort) return; g.rotation.z = -0.09 * Math.sin(p * Math.PI); },
    }));
    g.rotation.z = 0;
  }

  async _ready() {
    this._showEl('speech', false);
    this._showPrompt('TEST OBJECTIVE', 'Connect five pieces  ·  Manage Chaos Energy  ·  Use skills responsibly');
    await this._sleep(950);
    this._showPrompt('“Responsibly” is a non-binding suggestion.', '');
    await this._cta('CONTINUE TO BRIEFING ▸', 'Next: a short skills walkthrough.\nEstimated completion time: 3–5 business disasters');
    this._hidePrompt();
    await this._say('Try not to take this personally.');
    await this._sleep(550);
    await this._say('I will.');
    await this._sleep(450);
  }

  _resetEls() {
    for (const k of ['boot', 'ackWrap', 'sys', 'card', 'speech', 'rule', 'prompt', 'cta', 'choices']) this._showEl(k, false);
    if (this.els.stamp) this.els.stamp.classList.remove('show');
    if (this.els.flash) this.els.flash.classList.remove('show');
    if (this.els.bootText) this.els.bootText.textContent = '';
    if (this.els.speechText) this.els.speechText.textContent = '';
    if (this.els.sys) this.els.sys.textContent = '';
    if (this.els.choices) this.els.choices.innerHTML = '';
    if (this.els.cta) this.els.cta.innerHTML = '';
  }
}
