import { useState } from 'react';
import { Maximize2 } from 'lucide-react';
import { FOCUS_HINTS } from '../../../config/displayNames';

// A per-device UI preference (not user data): never synced, so localStorage is
// correct. Read LAZILY in a useState initializer, never a useEffect (T10850 /
// design D14 — persistence is gesture-driven, never a render side effect).
export const COCKPIT_INTRO_SEEN_KEY = 'rb.focus.cockpitIntroSeen';

function readSeen() {
  try {
    return localStorage.getItem(COCKPIT_INTRO_SEEN_KEY) === '1';
  } catch {
    // Private-mode / storage-disabled: treat as not-yet-seen, never throw.
    return false;
  }
}

/**
 * useCockpitIntroSeen (T10850, design D14) — owns the one-shot "seen" flag for the
 * landscape first-entry card. Co-located with the card so the shell (FocusCockpit)
 * has ONE source of truth to drive all three surfaces at once: the card itself,
 * the ring on the play button, and the ring on the CTA.
 *
 * `seen` is read lazily (never an effect). `markSeen` is the NAMED-GESTURE write —
 * the shell calls it from the card's "Got it" tap AND from the first `pointerdown`
 * on the stage. It is NEVER called on render: nothing is written just because the
 * card appeared. If the parent rotates away without touching anything, the card
 * returns next time — correct and intended.
 */
export function useCockpitIntroSeen() {
  const [seen, setSeen] = useState(readSeen);

  const markSeen = () => {
    if (seen) return; // idempotent — the second dismissal gesture is a no-op
    setSeen(true);
    try {
      localStorage.setItem(COCKPIT_INTRO_SEEN_KEY, '1');
    } catch {
      // Persist is best-effort; a failed write just means it reappears later.
    }
  };

  return { seen, markSeen };
}

/**
 * CockpitIntroCard (T10850, design D14) — a small card over the stage on the first
 * landscape entry, explaining what moved (playback to the left edge, the CTA to
 * the right). Purely presentational: the shell gates it on `!seen` and passes the
 * dismissal handler. "Got it" is a real 44px button with an aria-label; the OTHER
 * dismissal gesture (first stage pointerdown) is wired in the shell.
 */
export default function CockpitIntroCard({ onDismiss }) {
  return (
    <div
      data-testid="cockpit-intro-card"
      role="dialog"
      aria-label={FOCUS_HINTS.COCKPIT_INTRO_TITLE}
      className="pointer-events-auto absolute left-1/2 top-1/2 z-30 w-[min(20rem,82%)] -translate-x-1/2 -translate-y-1/2
                 rounded-xl border border-white/15 bg-gray-900/95 p-4 shadow-xl"
    >
      <div className="flex items-start gap-2">
        <Maximize2 size={18} className="mt-0.5 shrink-0 text-blue-300" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-white">{FOCUS_HINTS.COCKPIT_INTRO_TITLE}</p>
          <p className="mt-1 text-xs text-gray-300">{FOCUS_HINTS.COCKPIT_INTRO_BODY}</p>
        </div>
      </div>
      <div className="mt-3 flex justify-end">
        <button
          type="button"
          data-testid="cockpit-intro-confirm"
          onClick={onDismiss}
          aria-label={FOCUS_HINTS.COCKPIT_INTRO_CONFIRM}
          title={FOCUS_HINTS.COCKPIT_INTRO_CONFIRM}
          className="flex h-11 min-w-[44px] items-center justify-center rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-500"
        >
          {FOCUS_HINTS.COCKPIT_INTRO_CONFIRM}
        </button>
      </div>
    </div>
  );
}
