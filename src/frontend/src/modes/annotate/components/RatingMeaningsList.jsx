import { Loader2, Star } from 'lucide-react';
import { RATING_ADJECTIVES, RATING_MEANINGS } from '../../../components/shared/clipConstants';

// Best-first order (5 -> 1), shared by every surface that shows the list.
export const RATING_VALUES = [5, 4, 3, 2, 1];

/**
 * RatingMeaningsList (T11120) — the ONE rating "meanings list": five rows,
 * best-first, each an amber 5-star strip + the rating's adjective + a one-line
 * meaning (RATING_MEANINGS). Extracted from the (since removed, T11840) RatingPill's inline picker so the
 * editor's rating pill AND the "Rate this play" gate modal render the SAME list
 * (owner ruling: "the editor's rating pill opens the SAME list, so it is one
 * component"). Presentation-only: the parent owns open/close, the heading, and
 * what picking a row does.
 *
 * @param {number|null} rating  currently selected rating (drives aria-checked)
 * @param {(value:number)=>void} onPick  called with the chosen rating
 * @param {string} headingId  id of the parent's heading, for the radiogroup's
 *        accessible name (aria-labelledby)
 * @param {number|null} pendingRating  T11400: a rating whose persisted write is
 *        in flight. When set, the gate has acknowledged the pick immediately —
 *        that row shows as selected + busy (spinner, aria-busy) and EVERY row is
 *        disabled so a second pick can't fire while the first is still saving.
 *        Defaults to null, so surfaces that don't opt in (the editor's rating
 *        pill) keep the original interactive behavior unchanged.
 */
export function RatingMeaningsList({ rating, onPick, headingId, pendingRating = null }) {
  const submitting = pendingRating != null;
  return (
    <div role="radiogroup" aria-labelledby={headingId} className="flex flex-col gap-1">
      {RATING_VALUES.map((value) => {
        const isPending = pendingRating === value;
        const selected = rating === value || isPending;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-busy={isPending || undefined}
            disabled={submitting}
            aria-label={`${value} star${value > 1 ? 's' : ''} - ${RATING_ADJECTIVES[value]}`}
            onClick={() => onPick(value)}
            className={`w-full flex items-start gap-2.5 px-3 py-2.5 rounded-lg text-sm text-left
                        coarse-pointer:min-h-[44px] coarse-pointer:py-3 transition-colors ${
              selected
                ? 'bg-gray-700 text-white'
                : 'text-gray-300 hover:bg-gray-700/70 hover:text-white'
            } ${submitting && !isPending ? 'opacity-50' : ''} ${submitting ? 'cursor-default' : ''}`}
          >
            <span className="flex items-center gap-0.5 shrink-0 pt-0.5">
              {[1, 2, 3, 4, 5].map((i) => (
                <Star
                  key={i}
                  size={14}
                  fill={i <= value ? '#fbbf24' : 'transparent'}
                  color={i <= value ? '#fbbf24' : '#6b7280'}
                  strokeWidth={1.5}
                />
              ))}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-medium leading-tight">{RATING_ADJECTIVES[value]}</span>
              <span className="block text-xs text-gray-400 leading-snug">{RATING_MEANINGS[value]}</span>
            </span>
            {isPending && (
              <Loader2 size={16} className="shrink-0 mt-0.5 animate-spin text-white" aria-hidden="true" />
            )}
          </button>
        );
      })}
    </div>
  );
}

export default RatingMeaningsList;
