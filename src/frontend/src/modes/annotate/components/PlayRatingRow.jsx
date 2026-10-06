import { useId, useRef } from 'react';
import { Star, Sparkles } from 'lucide-react';
import { ANNOTATE } from '../../../config/displayNames';
import { RATING_ADJECTIVES, RATING_BADGE_COLORS, RATING_MEANINGS, displayRating } from '../../../components/shared/clipConstants';

/**
 * PlayRatingRow (T11840) - the play editor's ONE rating control. A question, five
 * 44px star buttons with the RATING_ADJECTIVES word always visible under each, a
 * caption giving the selected rating's RATING_MEANINGS line.
 *
 * Replaces the gray "Rate this play" pill and the bare unlabeled star row. It is
 * purely presentational: the rating write is the caller's `onRatingChange` (the
 * existing gesture path); it is not a new write path.
 *
 * Cells are bordered translucent surfaces with light text so the control reads as
 * tappable, not disabled. The 5-star cell is the gold call to action
 * (RATING_BADGE_COLORS[5], #F5B700, T11110); focus is a cyan ring so it never
 * reads as the gold cell.
 * `data-testid="rating-input"` + `data-rating` are the stable hooks for tests.
 */
const GOLD = RATING_BADGE_COLORS[5];

export function PlayRatingRow({ rating: storedRating, onRatingChange, className = '' }) {
  // Legacy null rating displays as Good (display only; nothing is written).
  const rating = displayRating(storedRating);
  const questionId = useId();
  const hintId = useId();
  const radioRefs = useRef([]);
  // WAI-ARIA radio group: roving tabindex (the selected radio is the tab stop)
  // and arrow keys move focus AND select through the same onRatingChange as a click
  // (selecting 5 only rates; the highlight choice opens on Done, not here).
  const tabStop = rating;
  const handleKeyDown = (e, value) => {
    let next;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = value === 5 ? 1 : value + 1;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = value === 1 ? 5 : value - 1;
    else return;
    e.preventDefault();
    radioRefs.current[next - 1]?.focus();
    onRatingChange(next);
  };
  return (
    <div
      data-testid="rating-input"
      data-rating={rating}
      className={className}
    >
      <div id={questionId} className="text-sm font-medium text-white mb-1.5">
        {ANNOTATE.RATING_QUESTION}{' '}
        <span className="text-xs font-normal text-gray-400">{ANNOTATE.RATING_CHANGE_HINT}</span>
      </div>
      <div
        role="radiogroup"
        aria-labelledby={questionId}
        aria-describedby={hintId}
        className="grid grid-cols-5 gap-1.5 max-w-md"
      >
        {[1, 2, 3, 4, 5].map((value) => {
          const selected = rating === value;
          const filled = value <= rating;
          const adjective = RATING_ADJECTIVES[value];
          const isBrilliant = value === 5;
          let cellTone;
          if (isBrilliant) {
            cellTone = selected
              ? 'bg-[#F5B700]/30 border-[#F5B700]'
              : 'bg-[#F5B700]/15 border-[#F5B700]/60 hover:bg-[#F5B700]/25 hover:border-[#F5B700] active:bg-[#F5B700]/30';
          } else {
            cellTone = selected
              ? 'bg-white/20 border-white'
              : 'bg-white/10 border-white/20 hover:bg-white/15 hover:border-white/40 active:bg-white/20';
          }
          let labelTone = 'text-gray-200';
          if (selected) labelTone = 'text-white font-semibold';
          else if (isBrilliant) labelTone = 'text-[#F5B700] font-semibold';
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={`${value} star${value > 1 ? 's' : ''} - ${adjective}`}
              title={`${value} star${value > 1 ? 's' : ''}`}
              ref={(el) => { radioRefs.current[value - 1] = el; }}
              tabIndex={value === tabStop ? 0 : -1}
              onClick={() => onRatingChange(value)}
              onKeyDown={(e) => handleKeyDown(e, value)}
              className={`flex min-h-[48px] cursor-pointer flex-col items-center justify-start gap-0.5 rounded-lg border px-0.5 py-1.5 transition-colors active:scale-[0.97] focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${cellTone}`}
            >
              <Star
                size={24}
                fill={filled ? '#fbbf24' : 'transparent'}
                color={filled ? '#fbbf24' : (isBrilliant ? GOLD : '#d1d5db')}
                strokeWidth={1.75}
                aria-hidden="true"
              />
              <span
                className={`text-xs leading-tight text-center break-words ${labelTone}`}
              >
                {adjective}
              </span>
            </button>
          );
        })}
      </div>
      <p id={hintId} className="mt-2 flex items-center gap-1.5 text-sm text-gray-100">
        {rating === 5 && (
          <Sparkles size={14} className="shrink-0 text-[#F5B700]" aria-hidden="true" />
        )}
        <span>{RATING_MEANINGS[rating]}</span>
      </p>
    </div>
  );
}

export default PlayRatingRow;
