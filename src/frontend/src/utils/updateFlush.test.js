import { describe, it, expect, beforeEach, vi } from 'vitest';
import { flushDurableState } from './updateFlush';
import { useFramingStore } from '../stores/framingStore';
import { useOverlayActionStore } from '../stores/overlayActionStore';

vi.mock('./apiFetch', () => ({ default: vi.fn() }));
import apiFetch from './apiFetch';

/**
 * T5070 — the step-3 flush is a DRAIN + VERIFY, not a full-state dump (see
 * docs/plans/tasks/T5070-design.md §5.2). These tests pin: overlay-queue
 * drain runs first and is a hard barrier; the framing fallback only fires
 * when a save is actually registered (near-no-op otherwise); and the
 * flush-verify barrier surfaces the backend's failure detail (or a default)
 * and never resolves on a non-ok response.
 */
describe('flushDurableState', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    useFramingStore.setState({ activeSaveCurrentClipState: null });
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
    apiFetch.mockResolvedValue({ ok: true });

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

  it('calls the registered framing save when an editor is mounted with uncommitted state', async () => {
    useOverlayActionStore.setState({ retryFailedOverlayActions: vi.fn().mockResolvedValue(true) });
    const framingSave = vi.fn().mockResolvedValue(undefined);
    useFramingStore.setState({ activeSaveCurrentClipState: framingSave });
    apiFetch.mockResolvedValue({ ok: true });

    await flushDurableState();

    expect(framingSave).toHaveBeenCalledTimes(1);
  });

  it('does not call any framing save when no editor is mounted (the near-no-op path)', async () => {
    useOverlayActionStore.setState({ retryFailedOverlayActions: vi.fn().mockResolvedValue(true) });
    apiFetch.mockResolvedValue({ ok: true });

    await expect(flushDurableState()).resolves.toBeUndefined();
  });

  it('throws with the backend detail message when flush-verify returns 503 sync_failed', async () => {
    useOverlayActionStore.setState({ retryFailedOverlayActions: vi.fn().mockResolvedValue(true) });
    apiFetch.mockResolvedValue({
      ok: false,
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
      json: async () => { throw new Error('not json'); },
    });

    await expect(flushDurableState()).rejects.toThrow(/Could not confirm/);
  });
});
