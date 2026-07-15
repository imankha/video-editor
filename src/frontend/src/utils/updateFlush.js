/**
 * T5070 — the update gate's step-3 durable flush.
 *
 * Every committed edit is already surgically persisted per-gesture (framing/
 * overlay/annotation actions), so this is a DRAIN + VERIFY, not a full-state
 * dump of React/hook state:
 *   1. Drain the overlay action retry queue (already gesture-sanctioned). If
 *      a retry is already in flight (triggered elsewhere), wait for it
 *      instead of racing a second one / misreading its early-return guard as
 *      a failure.
 *   2. Framing fallback: only if a Framing editor is mounted with an
 *      uncommitted full-state save registered AND the store's own dirty flag
 *      (framingChangedSinceExport) says something actually changed -- a
 *      clean or mid-restore editor must NOT trigger a full-state save (that
 *      is exactly the T4020 shadow-save class of bug: a redundant save on
 *      unchanged/half-loaded state can write an empty version).
 *   3. Barrier: POST /api/sync/flush-verify and AWAIT confirmation that
 *      whatever is dirty landed in R2. A 401 means there is no session (no
 *      per-user state could possibly be dirty) -- that is not a flush
 *      failure, so it resolves rather than throwing. Any other non-ok
 *      response throws so the caller (updateGateStore.runUpdate) never
 *      proceeds to the destructive cache flush with unsynced state.
 *
 * This is invoked from the "Update now" click handler ONLY -- never from a
 * useEffect watching state (CLAUDE.md: Persistence: Gesture-Based, Never
 * Reactive). Runtime fixups (ensurePermanentKeyframes, origin normalization)
 * and banned view-state are never read or sent here.
 */

import { API_BASE } from '../config';
import apiFetch from './apiFetch';
import { useFramingStore } from '../stores/framingStore';
import { useOverlayActionStore } from '../stores/overlayActionStore';

const DEFAULT_FLUSH_FAILURE_MESSAGE =
  "Could not confirm your latest changes were saved. Please try again.";

async function drainOverlayQueue() {
  if (useOverlayActionStore.getState().isRetrying) {
    // Someone else already kicked off a retry -- wait for it rather than
    // calling retryFailedOverlayActions() again (its own guard would just
    // return false immediately, which is NOT the same as "still failing").
    await new Promise((resolve) => {
      const unsubscribe = useOverlayActionStore.subscribe((state) => {
        if (!state.isRetrying) {
          unsubscribe();
          resolve();
        }
      });
    });
    if (useOverlayActionStore.getState().failedActions.length > 0) {
      throw new Error("Some highlight edits haven't saved yet. Please try again.");
    }
    return;
  }

  const overlayDrained = await useOverlayActionStore.getState().retryFailedOverlayActions();
  if (!overlayDrained) {
    throw new Error("Some highlight edits haven't saved yet. Please try again.");
  }
}

export async function flushDurableState() {
  await drainOverlayQueue();

  const { activeSaveCurrentClipState, framingChangedSinceExport } = useFramingStore.getState();
  if (activeSaveCurrentClipState && framingChangedSinceExport) {
    await activeSaveCurrentClipState();
  }

  const response = await apiFetch(`${API_BASE}/api/sync/flush-verify`, { method: 'POST' });
  if (response.status === 401) {
    // No session -> nothing per-user to flush. Not a failure.
    return;
  }
  if (!response.ok) {
    let message = DEFAULT_FLUSH_FAILURE_MESSAGE;
    try {
      const body = await response.json();
      message = body?.detail?.detail || (typeof body?.detail === 'string' ? body.detail : message);
    } catch {
      // Non-JSON error body — keep the default message.
    }
    throw new Error(message);
  }
}
