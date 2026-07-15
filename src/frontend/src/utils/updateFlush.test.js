import { describe, it, expect, beforeEach, vi } from 'vitest';
import { flushDurableState } from './updateFlush';
import { useFramingStore } from '../stores/framingStore';
import { useOverlayActionStore } from '../stores/overlayActionStore';

vi.mock('./apiFetch', () => ({ default: vi.fn() }));
import apiFetch from './apiFetch';

/**
 * T5070 — the step-3 flush is a DRAIN + VERIFY, not a full-state dump (see
 * docs/plans/tasks/T5070-design.md §5.2). These tests pin: overlay-queue
 * drain runs first and is a hard barrier (including the in-flight-retry
 * race, m3); the framing fallback only fires when the store's own dirty
 * flag says something actually changed (G2 — never an unconditional
 * full-state save, which would re-open the T4020 shadow-save bug); and the
 * flush-verify barrier surfaces the backend's failure detail (or a
 * default), tolerates a 401 (no session -> nothing to flush, not a
 * failure — B1), and never resolves on any other non-ok response.
 */
describe('flushDurableState', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    useFramingStore.setState({ activeSaveCurrentClipState: null, framingChangedSinceExport: false });
    useOverlayActionStore.setState({
      failedActions: [],
      isRetrying: false,
      _toastId: null,
      retryFailedOverlayActions: useOverlayActionStore.getInitialState().retryFailedOverlayActions,
    });
  });

  it('drains the overlay queue, then verifies with the backend', async () => {
    const retryFn = vi.fn().mockResolvedValue(true);
    useOverlayActionStore.setState({ retryFailedOverlayActions: retryFn });
    apiFetch.mockResolvedValue({ ok: true, status: 200 });

    await flushDurableState();

    expect(retryFn).toHaveBeenCalledTimes(1);
    expect(apiFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/sync/flush-verify'),
      { method: 'POST' },
    );
  });

  it('throws (barrier fails) when queued overlay actions are still failing, and never reaches flush-verify', async () => {
    useOverlayActionStore.setState({ retryFailedOverlayActions: vi.fn().mockResolvedValue(false) });

    await expect(flushDurableState()).rejects.toThrow(/highlight edits/i);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('m3: waits for an in-flight overlay retry instead of misreading its early-return guard as a failure', async () => {
    // Simulate a retry already in progress (isRetrying true) — calling
    // retryFailedOverlayActions() again would short-circuit false immediately
    // per its own guard, which must NOT be read as "still failing".
    useOverlayActionStore.setState({ isRetrying: true, failedActions: [{ key: 'k1' }] });
    const retryFn = vi.fn().mockResolvedValue(false); // must not be called at all
    useOverlayActionStore.setState({ retryFailedOverlayActions: retryFn });
    apiFetch.mockResolvedValue({ ok: true, status: 200 });

    const pending = flushDurableState();
    // Let the in-flight retry "complete" successfully.
    useOverlayActionStore.setState({ isRetrying: false, failedActions: [] });

    await expect(pending).resolves.toBeUndefined();
    expect(retryFn).not.toHaveBeenCalled();
  });

  it('m3: an in-flight overlay retry that finishes still-failing keeps the barrier failed', async () => {
    useOverlayActionStore.setState({ isRetrying: true, failedActions: [{ key: 'k1' }] });

    const pending = flushDurableState();
    useOverlayActionStore.setState({ isRetrying: false, failedActions: [{ key: 'k1' }] });

    await expect(pending).rejects.toThrow(/highlight edits/i);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('G2: calls the registered framing save when the store flags real uncommitted changes', async () => {
    useOverlayActionStore.setState({ retryFailedOverlayActions: vi.fn().mockResolvedValue(true) });
    const framingSave = vi.fn().mockResolvedValue(undefined);
    useFramingStore.setState({ activeSaveCurrentClipState: framingSave, framingChangedSinceExport: true });
    apiFetch.mockResolvedValue({ ok: true, status: 200 });

    await flushDurableState();

    expect(framingSave).toHaveBeenCalledTimes(1);
  });

  it('G2: does NOT call the framing save when an editor is mounted but nothing changed (clean/mid-restore)', async () => {
    useOverlayActionStore.setState({ retryFailedOverlayActions: vi.fn().mockResolvedValue(true) });
    const framingSave = vi.fn().mockResolvedValue(undefined);
    useFramingStore.setState({ activeSaveCurrentClipState: framingSave, framingChangedSinceExport: false });
    apiFetch.mockResolvedValue({ ok: true, status: 200 });

    await flushDurableState();

    expect(framingSave).not.toHaveBeenCalled();
  });

  it('does not call any framing save when no editor is mounted (the near-no-op path)', async () => {
    useOverlayActionStore.setState({ retryFailedOverlayActions: vi.fn().mockResolvedValue(true) });
    apiFetch.mockResolvedValue({ ok: true, status: 200 });

    await expect(flushDurableState()).resolves.toBeUndefined();
  });

  it('B1: a 401 from flush-verify (no session) resolves instead of throwing', async () => {
    useOverlayActionStore.setState({ retryFailedOverlayActions: vi.fn().mockResolvedValue(true) });
    apiFetch.mockResolvedValue({ ok: false, status: 401 });

    await expect(flushDurableState()).resolves.toBeUndefined();
  });

  it('throws with the backend detail message when flush-verify returns 503 sync_failed', async () => {
    useOverlayActionStore.setState({ retryFailedOverlayActions: vi.fn().mockResolvedValue(true) });
    apiFetch.mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({
        detail: {
          code: 'sync_failed',
          retryable: true,
          detail: 'Could not confirm your latest changes were saved. Please try again.',
        },
      }),
    });

    await expect(flushDurableState()).rejects.toThrow(
      'Could not confirm your latest changes were saved. Please try again.',
    );
  });

  it('falls back to a default message when the error body is not JSON', async () => {
    useOverlayActionStore.setState({ retryFailedOverlayActions: vi.fn().mockResolvedValue(true) });
    apiFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => { throw new Error('not json'); },
    });

    await expect(flushDurableState()).rejects.toThrow(/Could not confirm/);
  });
});
