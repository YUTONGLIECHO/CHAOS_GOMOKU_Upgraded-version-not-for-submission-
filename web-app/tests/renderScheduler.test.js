import { describe, expect, it, vi } from 'vitest';
import { RenderScheduler, ResultTimer } from '../renderScheduler.js';

function makeScheduler(onFrame = () => false) {
  let hidden = false;
  let nextId = 1;
  const frames = new Map();
  const cancelled = [];
  const scheduler = new RenderScheduler({
    requestFrame: (cb) => {
      const id = nextId++;
      frames.set(id, cb);
      return id;
    },
    cancelFrame: (id) => {
      cancelled.push(id);
      frames.delete(id);
    },
    isHidden: () => hidden,
    onFrame,
  });
  const runNext = (time = 16) => {
    const [id, cb] = frames.entries().next().value || [];
    if (!cb) return false;
    frames.delete(id);
    cb(time);
    return true;
  };
  return {
    scheduler,
    frames,
    cancelled,
    runNext,
    setHidden: (value) => {
      hidden = value;
    },
  };
}

describe('RenderScheduler', () => {
  it('coalesces repeated invalidations into one RAF', () => {
    const h = makeScheduler();
    h.scheduler.invalidate();
    h.scheduler.invalidate();
    h.scheduler.invalidate();
    expect(h.frames.size).toBe(1);
  });

  it('stops after a static frame', () => {
    const onFrame = vi.fn(() => false);
    const h = makeScheduler(onFrame);
    h.scheduler.invalidate();
    h.runNext();
    expect(onFrame).toHaveBeenCalledOnce();
    expect(h.frames.size).toBe(0);
  });

  it('continues only while animation is active', () => {
    let active = true;
    const h = makeScheduler(() => active);
    h.scheduler.invalidate();
    h.runNext(16);
    expect(h.frames.size).toBe(1);
    active = false;
    h.runNext(32);
    expect(h.frames.size).toBe(0);
  });

  it('does not lose an invalidation raised during a frame', () => {
    let scheduler;
    const h = makeScheduler(() => {
      scheduler.invalidate();
      return false;
    });
    scheduler = h.scheduler;
    scheduler.invalidate();
    h.runNext();
    expect(h.frames.size).toBe(1);
  });

  it('cancels on hide and schedules a fresh frame on restore', () => {
    const h = makeScheduler();
    h.scheduler.invalidate();
    const pending = h.scheduler.rafId;
    h.setHidden(true);
    h.scheduler.setHidden(true);
    expect(h.cancelled).toContain(pending);
    expect(h.frames.size).toBe(0);
    h.setHidden(false);
    h.scheduler.setHidden(false);
    expect(h.frames.size).toBe(1);
    expect(h.scheduler.lastFrameTime).toBe(0);
  });
});

describe('ResultTimer', () => {
  it('restart-style clear cancels a pending result', () => {
    vi.useFakeTimers();
    const show = vi.fn();
    const timer = new ResultTimer();
    timer.schedule({ isCurrent: () => true, onShow: show });
    timer.clear();
    vi.advanceTimersByTime(700);
    expect(show).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('stale result callbacks cannot affect a new match', () => {
    vi.useFakeTimers();
    let generation = 1;
    const show = vi.fn();
    const timer = new ResultTimer();
    const captured = generation;
    timer.schedule({ isCurrent: () => generation === captured, onShow: show });
    generation++;
    vi.advanceTimersByTime(700);
    expect(show).not.toHaveBeenCalled();
    expect(timer.id).toBe(0);
    vi.useRealTimers();
  });
});
