import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  useOverlayActionStore,
  runWithRetry,
  dispatchOverlayAction,
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
