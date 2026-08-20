import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  useOverlayActionStore,
  runWithRetry,
  dispatchOverlayAction,
  isRetryableFailure,
} from './overlayActionStore';
import { useToastStore } from '../components/shared/Toast';

/**
 * T4900 / prod bug 31p — overlay action failure visibility + bounded retry.
 * Covers the required matrix: happy path, mid-session failure burst,
 * retry-success, retry-fail-again, and the export-gate selector.
 */
describe('overlayActionStore', () => {
  beforeEach(() => {
    useOverlayActionStore.setState({ failedActions: [], isRetrying: false, _toastId: null });
    useToastStore.setState({ toasts: [] });
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('happy path: a succeeding action never queues a failure or shows a toast', async () => {
    const run = vi.fn().mockResolvedValue({ success: true, version: 3 });

    const result = await dispatchOverlayAction('addKeyframe', run);

    expect(run).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ success: true, version: 3 });
    expect(useOverlayActionStore.getState().failedActions).toHaveLength(0);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('runWithRetry retries a transient failure, then succeeds (same gesture)', async () => {
    vi.useFakeTimers();
    const run = vi
      .fn()
      .mockResolvedValueOnce({ success: false, error: 'Failed to fetch' })
      .mockResolvedValueOnce({ success: true });

    const pending = runWithRetry(run);
    await vi.runAllTimersAsync();
    const res = await pending;

    expect(res.success).toBe(true);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('failure burst: exhausts retries, queues the action, surfaces a persistent Retry toast', async () => {
    vi.useFakeTimers();
    const run = vi.fn().mockResolvedValue({ success: false, error: 'Failed to fetch' });

    const pending = dispatchOverlayAction('addKeyframe', run);
    await vi.runAllTimersAsync();
    await pending;

    expect(run).toHaveBeenCalledTimes(3); // initial + 2 retries

    const state = useOverlayActionStore.getState();
    expect(state.failedActions).toHaveLength(1);

    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].type).toBe('error');
    expect(toasts[0].duration).toBe(0); // persistent
    expect(toasts[0].action.label).toBe('Retry');
  });

  it('a second failure does not stack a second toast', async () => {
    vi.useFakeTimers();
    const run = vi.fn().mockResolvedValue({ success: false });

    const p1 = dispatchOverlayAction('addKeyframe', run);
    await vi.runAllTimersAsync();
    await p1;
    const p2 = dispatchOverlayAction('updateRegionEnd', run);
    await vi.runAllTimersAsync();
    await p2;

    expect(useOverlayActionStore.getState().failedActions).toHaveLength(2);
    expect(useToastStore.getState().toasts).toHaveLength(1);
  });

  it('re-surfaces a fresh toast if the user dismissed the previous one (X button)', async () => {
    vi.useFakeTimers();
    const run = vi.fn().mockResolvedValue({ success: false });

    const p1 = dispatchOverlayAction('addKeyframe', run);
    await vi.runAllTimersAsync();
    await p1;
    const firstToastId = useOverlayActionStore.getState()._toastId;
    expect(useToastStore.getState().toasts).toHaveLength(1);

    // User clicks the toast's X — it leaves the toast store but does NOT tell
    // overlayActionStore, so _toastId is now stale.
    useToastStore.getState().removeToast(firstToastId);
    expect(useToastStore.getState().toasts).toHaveLength(0);

    // Another action fails — a fresh warning MUST appear (the bug: stale _toastId
    // used to suppress it, leaving the user with no visible failure state).
    const p2 = dispatchOverlayAction('updateRegionEnd', run);
    await vi.runAllTimersAsync();
    await p2;

    expect(useToastStore.getState().toasts).toHaveLength(1);
    expect(useToastStore.getState().toasts[0].action.label).toBe('Retry');
  });

  it('retry-success: re-sending the queued actions clears the failure state', async () => {
    vi.useFakeTimers();
    const run = vi
      .fn()
      .mockResolvedValueOnce({ success: false }) // dispatch attempt 1
      .mockResolvedValueOnce({ success: false }) // dispatch retry 1
      .mockResolvedValueOnce({ success: false }) // dispatch retry 2
      .mockResolvedValue({ success: true }); // retry re-send

    const p = dispatchOverlayAction('addKeyframe', run);
    await vi.runAllTimersAsync();
    await p;
    expect(useOverlayActionStore.getState().failedActions).toHaveLength(1);

    const rp = useOverlayActionStore.getState().retryFailedOverlayActions();
    await vi.runAllTimersAsync();
    const ok = await rp;

    expect(ok).toBe(true);
    expect(useOverlayActionStore.getState().failedActions).toHaveLength(0);
    // The persistent error toast is cleared once the queue drains.
    // (The success confirmation toast auto-dismisses, so we only assert the
    // error toast is gone.)
    expect(useToastStore.getState().toasts.some((t) => t.type === 'error')).toBe(false);
  });

  it('retry-fail-again: keeps the queue and re-surfaces the persistent toast', async () => {
    vi.useFakeTimers();
    const run = vi.fn().mockResolvedValue({ success: false });

    const p = dispatchOverlayAction('addKeyframe', run);
    await vi.runAllTimersAsync();
    await p;

    const rp = useOverlayActionStore.getState().retryFailedOverlayActions();
    await vi.runAllTimersAsync();
    const ok = await rp;

    expect(ok).toBe(false);
    expect(useOverlayActionStore.getState().failedActions).toHaveLength(1);
    const errorToasts = useToastStore.getState().toasts.filter((t) => t.type === 'error');
    expect(errorToasts).toHaveLength(1);
  });

  it('export-gate selector: failedActions length reflects unsaved failures', async () => {
    vi.useFakeTimers();
    expect(useOverlayActionStore.getState().failedActions.length).toBe(0);

    const run = vi.fn().mockResolvedValue({ success: false });
    const p = dispatchOverlayAction('addKeyframe', run);
    await vi.runAllTimersAsync();
    await p;

    expect(useOverlayActionStore.getState().failedActions.length).toBe(1);
  });

  it('reset clears the queue and dismisses the toast (project switch)', async () => {
    vi.useFakeTimers();
    const run = vi.fn().mockResolvedValue({ success: false });
    const p = dispatchOverlayAction('addKeyframe', run);
    await vi.runAllTimersAsync();
    await p;

    useOverlayActionStore.getState().reset();

    expect(useOverlayActionStore.getState().failedActions).toHaveLength(0);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });
});

/**
 * Prod report 2026-07-29: a deterministic 400 ("Keyframe at 2.0s not found")
 * was queued as if it were a dropped packet. Every Retry click re-sent the same
 * rejected request and failed identically, so the "Your edits aren't saving"
 * toast could only be cleared by refreshing the page.
 *
 * A 4xx is the server's verdict on THIS request; re-sending it unchanged cannot
 * change the answer. Only failures that plausibly benefit from another attempt
 * (no response, 5xx, 408, 429) are retried and queued.
 */
describe('overlayActionStore — retryability of deterministic failures', () => {
  beforeEach(() => {
    useOverlayActionStore.setState({ failedActions: [], isRetrying: false, _toastId: null });
    useToastStore.setState({ toasts: [] });
    vi.useRealTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each([
    ['no response at all (offline)', undefined, true],
    ['500 server error', 500, true],
    ['503 unavailable', 503, true],
    ['408 request timeout', 408, true],
    ['429 too many requests', 429, true],
    ['400 validation error', 400, false],
    ['404 not found', 404, false],
    ['409 conflict', 409, false],
  ])('isRetryableFailure: %s', (_label, status, expected) => {
    expect(isRetryableFailure({ success: false, status })).toBe(expected);
  });

  it('isRetryableFailure treats a thrown/absent result as retryable', () => {
    expect(isRetryableFailure(null)).toBe(true);
    expect(isRetryableFailure(undefined)).toBe(true);
  });

  it('runWithRetry stops after ONE attempt on a 4xx (no futile re-sends)', async () => {
    const run = vi
      .fn()
      .mockResolvedValue({ success: false, status: 400, error: 'Keyframe at 2.0s not found' });

    const res = await runWithRetry(run);

    expect(run).toHaveBeenCalledTimes(1); // NOT 3
    expect(res.success).toBe(false);
    expect(res.retryable).toBe(false);
  });

  it('a 4xx is NOT queued and shows a dismissible toast with no Retry button', async () => {
    const run = vi
      .fn()
      .mockResolvedValue({ success: false, status: 400, error: 'Keyframe at 2.0s not found' });

    await dispatchOverlayAction('deleteKeyframe', run);

    // Not queued: queuing would jam the export gate on work that can never be sent.
    expect(useOverlayActionStore.getState().failedActions).toHaveLength(0);

    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].type).toBe('error');
    expect(toasts[0].action).toBeUndefined(); // no Retry — there is nothing to retry
    expect(toasts[0].duration).toBeGreaterThan(0); // auto-dismisses, not a permanent banner
  });

  it('a 4xx still logs loudly (it is our bug, not the user\'s)', async () => {
    const run = vi.fn().mockResolvedValue({ success: false, status: 400, error: 'boom' });

    await dispatchOverlayAction('deleteKeyframe', run);

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('deleteKeyframe'),
      'boom',
    );
  });

  it('a queued action that turns deterministic is dropped, not retried forever', async () => {
    vi.useFakeTimers();
    // Queued while transient (network), then the server starts rejecting it.
    const run = vi
      .fn()
      .mockResolvedValueOnce({ success: false })
      .mockResolvedValueOnce({ success: false })
      .mockResolvedValueOnce({ success: false })
      .mockResolvedValue({ success: false, status: 400, error: 'Keyframe at 2.0s not found' });

    const p = dispatchOverlayAction('deleteKeyframe', run);
    await vi.runAllTimersAsync();
    await p;
    expect(useOverlayActionStore.getState().failedActions).toHaveLength(1);

    const rp = useOverlayActionStore.getState().retryFailedOverlayActions();
    await vi.runAllTimersAsync();
    const ok = await rp;

    // Queue drains: the user is told once and is no longer stuck behind a
    // Retry button that can never succeed.
    expect(ok).toBe(true);
    expect(useOverlayActionStore.getState().failedActions).toHaveLength(0);
    expect(useToastStore.getState().toasts.some((t) => t.action?.label === 'Retry')).toBe(false);
  });
});

/**
 * T4330 -- a 409 `version_conflict` result (from the new actionClient, design
 * doc section 5/9) is a THIRD category, distinct from both the retryable queue
 * and the deterministic "undo it" rejection toast:
 *   - it must NOT enter the retry queue (re-sending the same expected_version
 *     can only 409 again)
 *   - it must NOT show `_surfaceRejectionToast`'s "Undo it and try again" copy
 *     (there is nothing to undo -- the other tab's edit is legitimate)
 *   - it must be routed to the shared conflict-prompt util instead
 *
 * This routing does not exist yet -- `dispatch`/`isRetryableFailure` currently
 * classify a 409 as a deterministic (non-retryable) failure and send it through
 * `_surfaceRejectionToast`, which is the WRONG prompt. These tests are written
 * test-first and are expected to FAIL until the conflict routing is wired in
 * `overlayActionStore.js` (importing `surfaceConflictPrompt` or equivalent from
 * `src/frontend/src/utils/actionConflictPrompt.js`, per the design doc).
 */
describe('overlayActionStore -- 409 version_conflict routing (T4330)', () => {
  beforeEach(() => {
    useOverlayActionStore.setState({ failedActions: [], isRetrying: false, _toastId: null });
    useToastStore.setState({ toasts: [] });
    vi.useRealTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('a 409 version_conflict result is NOT queued for retry', async () => {
    const run = vi.fn().mockResolvedValue({
      success: false,
      status: 409,
      error: 'version_conflict',
      current_version: 9,
    });

    await dispatchOverlayAction('updateRegion', run);

    // Only ONE attempt -- a 409 must not be retried (isRetryableFailure or an
    // earlier short-circuit must stop it before the retry loop spends attempts).
    expect(run).toHaveBeenCalledTimes(1);
    expect(useOverlayActionStore.getState().failedActions).toHaveLength(0);
  });

  it('a 409 version_conflict does NOT show the generic "undo it" rejection toast', async () => {
    const run = vi.fn().mockResolvedValue({
      success: false,
      status: 409,
      error: 'version_conflict',
      current_version: 9,
    });

    await dispatchOverlayAction('updateRegion', run);

    const toasts = useToastStore.getState().toasts;
    // The rejection toast copy is "Undo it and try again" (_surfaceRejectionToast).
    // A 409 must never produce that message.
    expect(toasts.some((t) => /undo it and try again/i.test(t.message || ''))).toBe(false);
  });

  it('a 409 version_conflict routes to a refresh/conflict prompt distinct from the retry-queue toast', async () => {
    const run = vi.fn().mockResolvedValue({
      success: false,
      status: 409,
      error: 'version_conflict',
      current_version: 9,
    });

    await dispatchOverlayAction('updateRegion', run);

    const toasts = useToastStore.getState().toasts;
    expect(toasts.length).toBeGreaterThan(0);
    // The conflict prompt offers a Refresh action (design doc section 5), not
    // the retry-queue's "Retry" action.
    expect(toasts.some((t) => t.action?.label === 'Refresh')).toBe(true);
    expect(toasts.some((t) => t.action?.label === 'Retry')).toBe(false);
  });

  it('isRetryableFailure classifies a 409 version_conflict as non-retryable (handled, not queued)', () => {
    expect(
      isRetryableFailure({ success: false, status: 409, error: 'version_conflict' }),
    ).toBe(false);
  });
});
