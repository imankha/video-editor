import { useState } from 'react';
import { Clapperboard } from 'lucide-react';
import { ANNOTATE } from '../../../config/displayNames';

/**
 * HighlightChoiceCard (T11130) — the in-place gold choice card the Play editor
 * mode-swaps in for its edit strip / portrait strip when Done fires on a play
 * rated Highlight (5) that is not yet a highlight (T8600 mode-swap pattern; the
 * video stays visible above). Two choices, both creating the highlight through
 * the SAME container create path (createProject); the container owns the create
 * seam, its double-create ref guard, the toast, and any navigation — this card
 * is purely presentational plus a local pending flag for the button-disabled UX.
 *
 * Presentation B3 (owner, 2026-09-24): gold-outlined card, eyebrow "Highlight",
 * title "Make this a highlight now?", primary gold button with dark text. There
 * is no visible cancel — Escape is the only no-save exit (handled by the
 * overlay's window keydown, wired to onDismiss) and it never closes on backdrop
 * (the card is in-flow, not a portal, so there is no backdrop to click).
 *
 * Gold is #F5B700 (RATING_BADGE_COLORS[5], T11110) — the Highlight color.
 */
export function HighlightChoiceCard({ onMakeNow, onBackToEditing }) {
  // Local pending flag drives the disabled/opacity UX for a double-tap; the
  // container's synchronous ref guard is the real correctness guard against a
  // double-create (this can lag a render / not fire if the editor unmounts).
  const [pending, setPending] = useState(false);
  const run = (fn) => async () => {
    if (pending) return;
    setPending(true);
    try {
      await fn?.();
    } finally {
      setPending(false);
    }
  };

  return (
    <div
      data-testid="highlight-choice-card"
      className="rounded-lg border-2 border-[#F5B700]/70 bg-[#F5B700]/10 p-4 sm:p-5"
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-[#F5B700]">
        {ANNOTATE.HIGHLIGHT_CHOICE_EYEBROW}
      </p>
      <h3 className="mt-1 text-lg font-bold text-white">
        {ANNOTATE.HIGHLIGHT_CHOICE_TITLE}
      </h3>
      <div className="mt-4 flex flex-col gap-2">
        <button
          type="button"
          data-testid="highlight-choice-now"
          onClick={run(onMakeNow)}
          disabled={pending}
          className="w-full min-h-[48px] coarse-pointer:min-h-[52px] rounded-lg bg-[#F5B700] px-4 py-3 text-base font-bold text-[#1a1300] transition-colors hover:bg-[#ffc61a] disabled:opacity-60"
        >
          <span className="inline-flex items-center justify-center gap-2">
            <Clapperboard size={18} />
            {ANNOTATE.MAKE_HIGHLIGHT_NOW}
          </span>
        </button>
        <button
          type="button"
          data-testid="highlight-choice-later"
          onClick={run(onBackToEditing)}
          disabled={pending}
          className="w-full min-h-[48px] coarse-pointer:min-h-[52px] rounded-lg border border-gray-600 bg-gray-800 px-4 py-2 text-sm font-semibold text-gray-100 transition-colors hover:bg-gray-700 disabled:opacity-60"
        >
          {ANNOTATE.BACK_TO_EDITING}
          <span className="mt-0.5 block text-xs font-normal text-gray-400">
            {ANNOTATE.BACK_TO_EDITING_SUBTEXT}
          </span>
        </button>
      </div>
    </div>
  );
}

export default HighlightChoiceCard;
