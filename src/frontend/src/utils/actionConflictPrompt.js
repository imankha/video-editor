/**
 * Shared 409 conflict-prompt UX (T4330).
 *
 * A stale `expected_version` means another tab/session committed since this
 * one last read -- the ONLY sanctioned resolution is a user-initiated
 * refresh (no auto-merge, no silent rebase; design doc section 5). Both
 * framingActions and overlayActions route their `actionClient`'s
 * `onConflict` hook through this ONE helper so the two editors show the
 * SAME prompt instead of each re-implementing it. Framing has no failure
 * store (dedicated queue is overkill for a non-retryable prompt) -- this
 * util is the ONLY conflict UX surface for both.
 */

import { toast } from '../components/shared/Toast';

/**
 * Surface a persistent "someone else edited this" prompt with a Refresh action.
 * @param {*} _ids - entity ids the conflict occurred on (unused today, kept
 *   for parity with the `onConflict(ids, currentVersion)` client contract and
 *   for future per-entity messaging).
 * @param {number} _currentVersion - the server's current version at conflict time.
 */
export function surfaceConflictPrompt(_ids, _currentVersion) {
  toast.error('This project was edited elsewhere', {
    message: 'Refresh to load the latest.',
    duration: 0, // persistent until the user acts
    action: {
      label: 'Refresh',
      onClick: () => window.location.reload(),
    },
  });
}
