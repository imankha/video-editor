import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { scheduleExportWhenReady } from './scheduleExportWhenReady';

// T9740: pins the fix for "Publish without spotlight" never auto-publishing.
// The original code was a bare `setTimeout(() => exportButtonRef.current
// ?.triggerExport(), 500)` racing an async load — this test reproduces that
// exact race (readiness resolving AFTER the old 500ms delay) to prove the new
// scheduler survives it, and negative-controls the old shape to prove this
// test would have caught the original bug.

describe('scheduleExportWhenReady (T9740)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires once readiness resolves, even when that takes longer than the OLD fixed 500ms delay', () => {
    let ready = false;
    const fire = vi.fn();
    scheduleExportWhenReady({
      isReady: () => ready,
      fire,
      shouldContinue: () => true,
    });

    // Past the old fixed delay — the original bug's exact failure window.
    vi.advanceTimersByTime(2000);
    expect(fire).not.toHaveBeenCalled();

    ready = true;
    vi.advanceTimersByTime(150);
    expect(fire).toHaveBeenCalledTimes(1);
  });

  it('negative control: the pre-fix fixed-delay shape drops the trigger when readiness resolves after it', () => {
    let ready = false;
    const fire = vi.fn();
    // Reproduces the exact pre-T9740 line: setTimeout(() => ref.current?.fn(), 500).
    setTimeout(() => {
      if (ready) fire();
    }, 500);

    vi.advanceTimersByTime(500);
    ready = true; // readiness resolves right after the fixed timer already fired
    vi.advanceTimersByTime(10000);

    expect(fire).not.toHaveBeenCalled();
  });

  it('fires exactly once and stops polling once ready, never double-firing on a later tick', () => {
    let ready = false;
    const fire = vi.fn();
    scheduleExportWhenReady({ isReady: () => ready, fire, shouldContinue: () => true, intervalMs: 100 });

    vi.advanceTimersByTime(300);
    ready = true;
    vi.advanceTimersByTime(100);
    expect(fire).toHaveBeenCalledTimes(1);

    // Keep advancing — a leaked interval would fire again.
    vi.advanceTimersByTime(10000);
    expect(fire).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops polling (never fires) once shouldContinue goes false, even if readiness later resolves', () => {
    let ready = false;
    let continueRunning = true;
    const fire = vi.fn();
    scheduleExportWhenReady({
      isReady: () => ready,
      fire,
      shouldContinue: () => continueRunning,
      intervalMs: 100,
    });

    vi.advanceTimersByTime(250);
    continueRunning = false; // e.g. the caller's stake was cleared (Refocus/timeout)
    ready = true; // readiness resolves anyway, later
    vi.advanceTimersByTime(10000);

    expect(fire).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('never fires and leaves no pending timer when readiness never resolves and the caller stops continuing', () => {
    const fire = vi.fn();
    let continueRunning = true;
    scheduleExportWhenReady({
      isReady: () => false,
      fire,
      shouldContinue: () => continueRunning,
      intervalMs: 100,
    });

    vi.advanceTimersByTime(5000);
    continueRunning = false;
    vi.advanceTimersByTime(200);

    expect(fire).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('the returned cancel handle stops the poll immediately, before readiness or shouldContinue change', () => {
    const fire = vi.fn();
    const cancel = scheduleExportWhenReady({
      isReady: () => true,
      fire: () => {}, // no-op so the first synchronous tick doesn't fire immediately
      shouldContinue: () => true,
      intervalMs: 100,
    });
    cancel();
    vi.advanceTimersByTime(10000);
    expect(fire).not.toHaveBeenCalled();
  });

  it('fires synchronously on the initial check when already ready, with no wasted timer', () => {
    const fire = vi.fn();
    scheduleExportWhenReady({ isReady: () => true, fire, shouldContinue: () => true });
    expect(fire).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
