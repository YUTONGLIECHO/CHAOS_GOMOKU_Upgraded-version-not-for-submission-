// Small, testable requestAnimationFrame scheduler used by the 3D scene.
// It coalesces invalidations and stops completely when a frame reports that
// no animation is still active.
export class RenderScheduler {
  constructor({ requestFrame, cancelFrame, isHidden, onFrame }) {
    this.requestFrame = requestFrame;
    this.cancelFrame = cancelFrame;
    this.isHidden = isHidden;
    this.onFrame = onFrame;
    this.rafId = 0;
    this.needsRender = true;
    this.lastFrameTime = 0;
  }

  invalidate() {
    this.needsRender = true;
    if (!this.rafId && !this.isHidden()) {
      this.rafId = this.requestFrame((time) => this._frame(time));
    }
  }

  _frame(time) {
    this.rafId = 0;
    if (this.isHidden()) {
      this.needsRender = true;
      this.lastFrameTime = 0;
      return;
    }

    const requested = this.needsRender;
    this.needsRender = false;
    const dt = this.lastFrameTime ? Math.min(50, Math.max(0, time - this.lastFrameTime)) : 0;
    this.lastFrameTime = time;

    const animationActive = !!this.onFrame({ time, dt, requested });
    if (animationActive || this.needsRender) this.invalidate();
  }

  setHidden(hidden) {
    if (hidden) {
      if (this.rafId) this.cancelFrame(this.rafId);
      this.rafId = 0;
      this.needsRender = true;
      this.lastFrameTime = 0;
      return;
    }
    this.lastFrameTime = 0;
    this.invalidate();
  }

  dispose() {
    if (this.rafId) this.cancelFrame(this.rafId);
    this.rafId = 0;
    this.needsRender = false;
    this.lastFrameTime = 0;
  }
}

export class ResultTimer {
  constructor({ setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.id = 0;
  }

  schedule({ delay = 700, isCurrent, onShow }) {
    this.clear();
    this.id = this.setTimer(() => {
      this.id = 0;
      if (isCurrent()) onShow();
    }, delay);
  }

  clear() {
    if (this.id) this.clearTimer(this.id);
    this.id = 0;
  }
}
