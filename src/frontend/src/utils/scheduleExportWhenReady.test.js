import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { scheduleExportWhenReady, scheduleOverlayPublishExport } from './scheduleExportWhenReady';
import { usePublishIntentStore } from '../stores/publishIntentStore';

// T9740: pins the fix for "Publish without spotlight" never auto-publishing.
// The original code was a bare `setTimeout(() => exportButtonRef.current
// ?.triggerExport(), 500)` racing an async load — this test reproduces that
// exact race (readiness resolving AFTER the old 500ms delay) to prove the new
// scheduler survives it, and negative-controls the old shape to prove this
// test would have caught the original bug.
//
// T9740 v2 (PR #417 regression): fixing the 500ms race was NOT enough. The
// merged fix polled a SINGLE `exportButtonRef` shared across Focus's and
// Overlay's button instances. In production that ref is NON-NULL from the very
// first tick — Focus's own export button is already mounted on it when Publish
// is clicked — so `isReady: () => !!ref.current` was satisfied synchronously on
// tick zero and fired Focus's FRAMING render, not Overlay's. The scheduler-only
// tests below could never catch that because they drive `isReady` from a
// boolean that STARTS false; the real gate starts open against the wrong
// button. `scheduleOverlayPublishExport` (bound to Overlay's ref specifically)
// is the fix, and the `scheduleOverlayPublishExport` describe block below
// reproduces the two-ref production reality + a negative control against the
// old shared-ref predicate.

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

describe('scheduleExportWhenReady onAbandon (T9740 v2)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('calls onAbandon exactly once when shouldContinue goes false before ever firing', () => {
    let cont = true;
    const fire = vi.fn();
    const onAbandon = vi.fn();
    scheduleExportWhenReady({ isReady: () => false, fire, shouldContinue: () => cont, onAbandon, intervalMs: 100 });

    vi.advanceTimersByTime(250);
    cont = false; // stake expired before the export button ever mounted
    vi.advanceTimersByTime(100);

    expect(fire).not.toHaveBeenCalled();
    expect(onAbandon).toHaveBeenCalledTimes(1);
    // No leaked timer, and no repeat calls on further advance.
    vi.advanceTimersByTime(10000);
    expect(onAbandon).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does NOT call onAbandon after a successful fire', () => {
    let ready = false;
    const onAbandon = vi.fn();
    const fire = vi.fn();
    scheduleExportWhenReady({ isReady: () => ready, fire, shouldContinue: () => true, onAbandon, intervalMs: 100 });

    ready = true;
    vi.advanceTimersByTime(100);
    expect(fire).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(10000);
    expect(onAbandon).not.toHaveBeenCalled();
  });

  it('does NOT call onAbandon on an explicit cancel() teardown', () => {
    const onAbandon = vi.fn();
    const cancel = scheduleExportWhenReady({
      isReady: () => false,
      fire: vi.fn(),
      shouldContinue: () => true,
      onAbandon,
      intervalMs: 100,
    });
    cancel();
    vi.advanceTimersByTime(10000);
    expect(onAbandon).not.toHaveBeenCalled();
  });
});

describe('scheduleOverlayPublishExport — fires OVERLAY button only, never the shared/focus one (T9740 v2)', () => {
  beforeEach(() => { vi.useFakeTimers(); usePublishIntentStore.getState().clear(); });
  afterEach(() => { vi.useRealTimers(); usePublishIntentStore.getState().clear(); });

  it('never fires Focus\'s button (non-null from the start), fires Overlay\'s exactly once its ref attaches', () => {
    const focusSpy = vi.fn();
    const overlaySpy = vi.fn();
    // Production reality (the whole point of PR #417's regression): Focus's own
    // export button is ALREADY mounted on its OWN ref when Publish is clicked.
    // We hand the scheduler ONLY overlayRef (still null — its button mounts only
    // after the just-rendered working video hydrates); focusSpy stands in for
    // Focus's button and must never be reached, since the scheduler never sees
    // that ref at all. THAT is the fix: the trigger is bound to overlay's ref by
    // construction, so no state of Focus's ref can satisfy it.
    const overlayRef = { current: null };

    usePublishIntentStore.getState().set(7);
    scheduleOverlayPublishExport({ overlayExportButtonRef: overlayRef, projectId: 7 });

    // Well past the OLD fixed 500ms — Overlay still hydrating. The bug fired
    // Focus's button synchronously here; the fix must not touch it at all.
    vi.advanceTimersByTime(2000);
    expect(focusSpy).not.toHaveBeenCalled();
    expect(overlaySpy).not.toHaveBeenCalled();

    // Overlay's export button finally mounts.
    overlayRef.current = { triggerExport: overlaySpy };
    vi.advanceTimersByTime(150);
    expect(overlaySpy).toHaveBeenCalledTimes(1);
    expect(focusSpy).not.toHaveBeenCalled();
  });

  it('negative control: the OLD single-shared-ref predicate DOES fire the focus button on tick zero', () => {
    const focusSpy = vi.fn();
    // The pre-fix shape verbatim: ONE ref, already holding the framing button
    // at click time, polled with `!!sharedRef.current`. This is what shipped in
    // PR #417 and regressed staging.
    const sharedRef = { current: { triggerExport: focusSpy } };
    usePublishIntentStore.getState().set(7);

    scheduleExportWhenReady({
      isReady: () => !!sharedRef.current,
      fire: () => sharedRef.current.triggerExport(),
      shouldContinue: () => usePublishIntentStore.getState().projectId === 7,
    });

    // No timer advance: the synchronous tick-zero check already fired the WRONG
    // (framing) button — reproducing the exact regression, and proving the test
    // above discriminates the fix from the bug rather than just running clean.
    expect(focusSpy).toHaveBeenCalledTimes(1);
  });

  it('stops (and abandons) when the publish-intent stake clears before Overlay mounts', () => {
    const overlaySpy = vi.fn();
    const onAbandon = vi.fn();
    const overlayRef = { current: null };

    usePublishIntentStore.getState().set(7);
    scheduleOverlayPublishExport({ overlayExportButtonRef: overlayRef, projectId: 7, onAbandon });

    vi.advanceTimersByTime(300);
    usePublishIntentStore.getState().clear(); // e.g. Refocus / safety-net expiry
    vi.advanceTimersByTime(150);

    expect(overlaySpy).not.toHaveBeenCalled();
    expect(onAbandon).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
