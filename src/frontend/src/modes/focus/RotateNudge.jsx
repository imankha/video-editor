import { useState } from 'react';
import { RotateCw, X } from 'lucide-react';
import { FOCUS_HINTS } from '../../config/displayNames';

// A per-device UI preference (not user data): it never reaches the backend and
// needs no sync, so localStorage is correct here. Read LAZILY in a useState
// initializer, never a useEffect (T10850 / design D14 — the whole point of the
// task is that persistence is gesture-driven, never a render side effect).
export const ROTATE_NUDGE_DISMISSED_KEY = 'rb.focus.rotateNudgeDismissed';

function readDismissed() {
  try {
    return localStorage.getItem(ROTATE_NUDGE_DISMISSED_KEY) === '1';
  } catch {
    // Private-mode / storage-disabled: treat as not-yet-dismissed, never throw.
    return false;
  }
}

/**
 * RotateNudge (T10850, design D14) — a slim bar directly under the portrait stage
 * telling the parent the phone rotates into a bigger frame. This is the hint that
 * actually drives cockpit adoption: most users never turn the phone on their own.
 *
 * Shown when `isMobile && !isLandscape && !dismissed && the clip has no focus
 * points yet`. The "no focus points" gate is derived upstream from the crop
 * keyframe list already in scope (`hasFocusPoints`) — no new state or store field.
 *
 * Dismissed ONLY by the X tap, which is the single named gesture that writes the
 * key. If the parent never taps X and just rotates away, the nudge returns next
 * time — correct and intended, not a bug to "fix" with a write on mount.
 */
export default function RotateNudge({ isMobile, isLandscape, hasFocusPoints }) {
  const [dismissed, setDismissed] = useState(readDismissed);

  const show = isMobile && !isLandscape && !dismissed && !hasFocusPoints;
  if (!show) return null;

  // The X tap — the named gesture. Flip local state AND persist, together.
  const handleDismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(ROTATE_NUDGE_DISMISSED_KEY, '1');
    } catch {
      // Persist is best-effort; a failed write just means it reappears later.
    }
  };

  return (
    <div
      data-testid="rotate-nudge"
      className="mt-1 flex items-center gap-2 rounded-lg border border-blue-500/40 bg-blue-500/10 px-3 py-2"
    >
      <RotateCw size={18} className="shrink-0 text-blue-300" aria-hidden="true" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm font-semibold text-blue-100">{FOCUS_HINTS.ROTATE_TITLE}</span>
        <span className="text-xs text-blue-200/80">{FOCUS_HINTS.ROTATE_SUBTITLE}</span>
      </span>
      <button
        type="button"
        data-testid="rotate-nudge-dismiss"
        onClick={handleDismiss}
        aria-label={FOCUS_HINTS.ROTATE_DISMISS}
        title={FOCUS_HINTS.ROTATE_DISMISS}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-blue-200 hover:bg-white/10"
      >
        <X size={18} aria-hidden="true" />
      </button>
    </div>
  );
}
