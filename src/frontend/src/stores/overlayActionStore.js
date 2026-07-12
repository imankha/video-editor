import { create } from 'zustand';

import { toast, useToastStore } from '../components/shared/Toast';

/**
 * Overlay Action Failure Store (T4900 / prod bug 31p)
 *
 * Overlay edits persist as surgical fire-and-forget POSTs (see OverlayScreen +
 * api/overlayActions). Before this store, every failed POST was swallowed with a
 * bare `console.error` — so when the actions endpoint became unreachable (31p:
 * 188 "Failed to fetch" over a 6-minute session) the user kept editing with NO
 * indication their work wasn't saving, then fired an export that rendered stale
 * DB state (the T4900 "Add Spotlight ignored my keyframes" report).
 *
 * This store makes those failures VISIBLE and RECOVERABLE:
 *   - `dispatchOverlayAction` runs each action with a bounded retry (still the
 *     same user gesture — NOT a reactive background loop), and on final failure
 *     queues it and surfaces a persistent "Your edits aren't saving — Retry"
 *     toast (reusing the shared Toast, the T4110 sync_failed retryable-UX shape).
 *   - `retryFailedOverlayActions` re-sends the queued actions (gesture-initiated
 *     via the Retry button) and clears the state on success.
 *   - `useHasUnsavedOverlayFailures` lets the export gate block/warn on Add
 *     Spotlight while edits are unsaved, so the render can't use stale data.
 *
 * This is NOT reactive persistence: nothing here watches hook/store STATE to
 * write. Every write still originates from a user gesture; the retry is a
 * bounded re-attempt of that same gesture's write.
 */

// Bounded retry — same gesture, so a couple of quick re-attempts are fine.
export const MAX_RETRIES = 2;
export const RETRY_BASE_MS = 400;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run an overlay-action thunk with bounded exponential backoff.
 * `run` resolves to the overlayActions result ({ success, error }); the client
 * catches network errors internally and returns { success: false } rather than
 * throwing, but we also treat a thrown error as a failed attempt.
 *
 * @param {() => Promise<{success: boolean}>} run
 * @param {number} retries
 * @returns {Promise<{success: boolean, result?: object}>}
 */
export async function runWithRetry(run, retries = MAX_RETRIES) {
  let lastResult = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await run();
      lastResult = result;
      if (result && result.success) return { success: true, result };
    } catch (err) {
      lastResult = { success: false, error: err?.message };
    }
    if (attempt < retries) await sleep(RETRY_BASE_MS * Math.pow(2, attempt));
  }
  return { success: false, result: lastResult };
}

export const useOverlayActionStore = create((set, get) => ({
  // Queue of actions that exhausted their retries. Each entry: { key, label, run }.
  failedActions: [],
  isRetrying: false,
  // Id of the currently-shown persistent failure toast (null when none).
  _toastId: null,

  /**
   * Run a surgical overlay action with bounded retry. On final failure, queue it
   * for the Retry affordance and surface the persistent failure toast.
   * Returns the overlayActions result so awaited callers keep working.
   */
  dispatch: async (label, run) => {
    const { success, result } = await runWithRetry(run);
    if (!success) {
      const entry = { key: `${label}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`, label, run };
      set((s) => ({ failedActions: [...s.failedActions, entry] }));
      get()._surfaceFailureToast();
    }
    return result;
  },

  /**
   * Re-send every queued failed action (gesture: the Retry button, or the export
   * gate). Clears the state when the queue drains; re-surfaces the toast if some
   * still fail.
   */
  retryFailedOverlayActions: async () => {
    if (get().isRetrying) return false;
    const queued = get().failedActions;
    if (queued.length === 0) return true;

    set({ isRetrying: true });
    // Clear the toast id up front so a repeated failure surfaces a fresh toast.
    get()._dismissFailureToast();

    const stillFailed = [];
    for (const entry of queued) {
      const { success } = await runWithRetry(entry.run);
      if (!success) stillFailed.push(entry);
    }

    set({ failedActions: stillFailed, isRetrying: false });

    if (stillFailed.length > 0) {
      get()._surfaceFailureToast();
      return false;
    }
    toast.success('Your highlight edits are saved.');
    return true;
  },

  _surfaceFailureToast: () => {
    // Only skip if our tracked toast is STILL live. The shared Toast has its own
    // dismiss (X) button that removes the toast without telling us, so a stale
    // `_toastId` must not suppress a fresh warning — reconcile against the toast
    // store first, else a user who dismisses the toast loses all future warnings
    // while their edits keep silently failing.
    const trackedId = get()._toastId;
    if (trackedId != null) {
      const stillLive = useToastStore.getState().toasts.some((t) => t.id === trackedId);
      if (stillLive) return;
      set({ _toastId: null }); // it was dismissed — fall through and re-surface
    }
    const id = toast.error("Your edits aren't saving", {
      message: 'Some highlight changes could not be saved. Retry before exporting.',
      duration: 0, // persistent until retried/resolved
      action: {
        label: 'Retry',
        onClick: () => useOverlayActionStore.getState().retryFailedOverlayActions(),
      },
    });
    set({ _toastId: id });
  },

  _dismissFailureToast: () => {
    const id = get()._toastId;
    if (id != null) {
      useToastStore.getState().removeToast(id);
      set({ _toastId: null });
    }
  },

  /** Reset on project switch / overlay teardown so failures don't leak across projects. */
  reset: () => {
    get()._dismissFailureToast();
    set({ failedActions: [], isRetrying: false });
  },
}));

/**
 * Fire an overlay action through the failure-tracking + retry path.
 * Usable outside React (from gesture-handler closures).
 */
export function dispatchOverlayAction(label, run) {
  return useOverlayActionStore.getState().dispatch(label, run);
}

/** Selector: are there overlay edits that failed to save? (export gate reads this) */
export const useHasUnsavedOverlayFailures = () =>
  useOverlayActionStore((s) => s.failedActions.length > 0);
