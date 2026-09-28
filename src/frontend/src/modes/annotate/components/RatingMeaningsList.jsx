import { Star } from 'lucide-react';
import { RATING_ADJECTIVES, RATING_MEANINGS } from '../../../components/shared/clipConstants';

// Best-first order (5 -> 1), shared by every surface that shows the list.
export const RATING_VALUES = [5, 4, 3, 2, 1];

/**
 * RatingMeaningsList (T11120) — the ONE rating "meanings list": five rows,
 * best-first, each an amber 5-star strip + the rating's adjective + a one-line
 * meaning (RATING_MEANINGS). Extracted from RatingPill's inline picker so the
 * editor's rating pill AND the "Rate this play" gate modal render the SAME list
 * (owner ruling: "the editor's rating pill opens the SAME list, so it is one
 * component"). Presentation-only: the parent owns open/close, the heading, and
 * what picking a row does.
 *
 * @param {number|null} rating  currently selected rating (drives aria-checked)
 * @param {(value:number)=>void} onPick  called with the chosen rating
 * @param {string} headingId  id of the parent's heading, for the radiogroup's
 *        accessible name (aria-labelledby)
 */
export function RatingMeaningsList({ rating, onPick, headingId }) {
  return (
    <div role="radiogroup" aria-labelledby={headingId} className="flex flex-col gap-1">
      {RATING_VALUES.map((value) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={rating === value}
          aria-label={`${value} star${value > 1 ? 's' : ''} - ${RATING_ADJECTIVES[value]}`}
          onClick={() => onPick(value)}
          className={`w-full flex items-start gap-2.5 px-3 py-2.5 rounded-lg text-sm text-left
                      coarse-pointer:min-h-[44px] coarse-pointer:py-3 transition-colors ${
            rating === value
              ? 'bg-gray-700 text-white'
              : 'text-gray-300 hover:bg-gray-700/70 hover:text-white'
          }`}
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
          <span className="min-w-0">
            <span className="block font-medium leading-tight">{RATING_ADJECTIVES[value]}</span>
            <span className="block text-xs text-gray-400 leading-snug">{RATING_MEANINGS[value]}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

export default RatingMeaningsList;
