import { create } from 'zustand';

import { toast, useToastStore } from '../components/shared/Toast';
import { surfaceConflictPrompt } from '../utils/actionConflictPrompt';

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
 * Failures split by whether re-sending can plausibly help (`isRetryableFailure`):
 * a dropped request or a 5xx is worth retrying; a 4xx is the server's verdict on
 * this exact request and will repeat forever, so it is reported once instead of
 * being queued behind a Retry button that cannot work.
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
 * Is this failure worth sending again?
 *
 * A 4xx means the server READ this exact request and refused it, so re-sending
 * it byte-for-byte against unchanged state can only produce the same 4xx. That
 * is what stranded a user behind an unclearable "Your edits aren't saving —
 * Retry" toast: a deterministic 400 was queued as if it were a dropped packet,
 * and every Retry click re-failed identically until they refreshed the page.
 *
 * Transient (retryable): no response at all (offline / aborted), 5xx, plus the
 * two 4xx codes that explicitly mean "try again" — 408 and 429.
 *
 * @param {?{status?: number}} result
 * @returns {boolean}
 */
export function isRetryableFailure(result) {
  const status = result?.status;
  if (typeof status !== 'number') return true; // never reached the server
  if (status === 408 || status === 429) return true;
  return status < 400 || status >= 500;
}

/**
 * Run an overlay-action thunk with bounded exponential backoff.
 * `run` resolves to the overlayActions result ({ success, error, status }); the
 * client catches network errors internally and returns { success: false }
 * rather than throwing, but we also treat a thrown error as a failed attempt.
 *
 * Stops early on a non-retryable failure — the remaining attempts and their
 * backoff sleeps are pure waste, and the caller needs the verdict promptly.
 *
 * @param {() => Promise<{success: boolean}>} run
 * @param {number} retries
 * @returns {Promise<{success: boolean, result?: object, retryable?: boolean}>}
 */
export async function runWithRetry(run, retries = MAX_RETRIES) {
  let lastResult = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await run();
      lastResult = result;
      if (result && result.success) return { success: true, result };
      if (!isRetryableFailure(result)) return { success: false, result, retryable: false };
    } catch (err) {
      lastResult = { success: false, error: err?.message };
    }
    if (attempt < retries) await sleep(RETRY_BASE_MS * Math.pow(2, attempt));
  }
  return { success: false, result: lastResult, retryable: true };
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
    const { success, result, retryable } = await runWithRetry(run);
    if (!success) {
      if (result?.status === 409 && result?.error === 'version_conflict') {
        // T4330: a concurrent-edit conflict is a THIRD category, distinct
        // from both the retry queue and the deterministic "undo it" toast --
        // there is nothing to undo (the other tab's edit is legitimate) and
        // re-sending the same expected_version can only 409 again. The
        // actionClient already called onConflict internally; this is just
        // the store's own routing so a 409 never falls into the generic
        // rejection/queue paths below.
        surfaceConflictPrompt(label, result.current_version);
        return result;
      }
      if (retryable === false) {
        // The server rejected this specific action (4xx). Queuing it would
        // offer a Retry that is guaranteed to fail and would jam the export
        // gate on work that can never be sent, so report it and move on.
        get()._surfaceRejectionToast(label, result);
        return result;
      }
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
      const { success, result, retryable } = await runWithRetry(entry.run);
      if (success) continue;
      if (retryable === false) {
        // Turned deterministic since it was queued (e.g. the target no longer
        // exists). Keeping it would make every future Retry fail forever, so
        // drop it from the queue and say so instead.
        get()._surfaceRejectionToast(entry.label, result);
        continue;
      }
      stillFailed.push(entry);
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

  /**
   * Surface a DETERMINISTIC rejection (4xx). Deliberately different from the
   * retryable toast: no Retry button (there is nothing to retry) and it
   * auto-dismisses, so the user isn't left with a permanent banner they can
   * only clear by reloading. Logged loudly — a 4xx here is a bug on our side,
   * not a user error, and it must stay findable in the console.
   */
  _surfaceRejectionToast: (label, result) => {
    console.error(`[overlayActionStore] Action "${label}" rejected by server (not retryable):`, result?.error);
    toast.error("That highlight change didn't save", {
      message: 'The change is still on screen but was not stored. Undo it and try again.',
    });
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
