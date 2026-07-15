/**
 * T5070 — the update gate's step-3 durable flush.
 *
 * Every committed edit is already surgically persisted per-gesture (framing/
 * overlay/annotation actions), so this is a DRAIN + VERIFY, not a full-state
 * dump of React/hook state:
 *   1. Drain the overlay action retry queue (already gesture-sanctioned).
 *   2. Framing fallback: only if a Framing editor is mounted with an
 *      uncommitted full-state save registered (near-no-op in practice --
 *      see docs/plans/tasks/T5070-design.md §5.2).
 *   3. Barrier: POST /api/sync/flush-verify and AWAIT confirmation that
 *      whatever is dirty landed in R2. Throws on failure so the caller
 *      (updateGateStore.runUpdate) never proceeds to the destructive cache
 *      flush with unsynced state.
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

export async function flushDurableState() {
  const overlayDrained = await useOverlayActionStore.getState().retryFailedOverlayActions();
  if (!overlayDrained) {
    throw new Error("Some highlight edits haven't saved yet. Please try again.");
  }

  const pendingFramingSave = useFramingStore.getState().activeSaveCurrentClipState;
  if (pendingFramingSave) {
    await pendingFramingSave();
  }

  const response = await apiFetch(`${API_BASE}/api/sync/flush-verify`, { method: 'POST' });
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
