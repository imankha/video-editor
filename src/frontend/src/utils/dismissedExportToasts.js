// T15740: per-device record of which export-complete/error toasts the user has
// already dismissed, so a reload within GlobalExportIndicator's recency window
// doesn't re-show one they already closed. A purely per-device UI preference
// (never reaches the backend, needs no sync) -- the narrow localStorage
// exception CLAUDE.md carries for a dismissed-hint flag. Read lazily, written
// ONLY by the toast's own Dismiss/click gesture (Toast.jsx's handleDismiss).
export const DISMISSED_EXPORT_TOASTS_KEY = 'rb.exports.dismissedToastIds';
const MAX_REMEMBERED = 50;

export function readDismissedExportToastIds() {
  try {
    const raw = localStorage.getItem(DISMISSED_EXPORT_TOASTS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    // Private-mode / storage-disabled / corrupt JSON: treat as none dismissed.
    return new Set();
  }
}

export function rememberDismissedExportToast(exportId) {
  try {
    const ids = [...readDismissedExportToastIds()];
    ids.push(exportId);
    // Cap to the most recent N -- this is a reload-reshow guard, not a log.
    const trimmed = ids.slice(-MAX_REMEMBERED);
    localStorage.setItem(DISMISSED_EXPORT_TOASTS_KEY, JSON.stringify(trimmed));
  } catch {
    // Persist is best-effort; a failed write just means it can reappear once.
  }
}
