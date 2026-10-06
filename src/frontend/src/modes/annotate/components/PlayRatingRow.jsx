import { useId, useRef } from 'react';
import { Star, Sparkles } from 'lucide-react';
import { ANNOTATE } from '../../../config/displayNames';
import { RATING_ADJECTIVES, RATING_BADGE_COLORS } from '../../../components/shared/clipConstants';

/**
 * PlayRatingRow (T11840) - the play editor's ONE rating control. A question, five
 * 44px star buttons with the RATING_ADJECTIVES word always visible under each, a
 * caption naming the 5-star highlight offer, and (for a play that is not Brilliant
 * and has no highlight yet) the "Make a highlight anyway" text button.
 *
 * Replaces the gray "Rate this play" pill and the bare unlabeled star row. It is
 * purely presentational: the rating write is the caller's `onRatingChange` (the
 * existing gesture path) and "anyway" only asks the container to open the SAME
 * HighlightChoiceCard; neither is a new write path.
 *
 * The 5-star cell's gold ring is RATING_BADGE_COLORS[5] (#F5B700, T11110).
 * `data-testid="rating-input"` + `data-rating` are the stable hooks for tests.
 */
export function PlayRatingRow({ rating, onRatingChange, showMakeAnyway = false, onMakeHighlightAnyway, className = '' }) {
  const questionId = useId();
  const hintId = useId();
  const radioRefs = useRef([]);
  // WAI-ARIA radio group: roving tabindex (selected, else first, is the tab stop)
  // and arrow keys move focus AND select through the same onRatingChange as a click
  // (selecting 5 only rates; the highlight choice opens on Done, not here).
  const tabStop = rating ?? 1;
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
      data-rating={rating ?? ''}
      className={className}
    >
      <div id={questionId} className="text-sm text-gray-300 mb-1">
        {ANNOTATE.RATING_QUESTION}
      </div>
      <div
        role="radiogroup"
        aria-labelledby={questionId}
        aria-describedby={hintId}
        className="grid grid-cols-5 gap-1 max-w-md"
      >
        {[1, 2, 3, 4, 5].map((value) => {
          const selected = rating === value;
          const filled = rating != null && value <= rating;
          const adjective = RATING_ADJECTIVES[value];
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
              style={value === 5 ? { boxShadow: `0 0 0 1px ${RATING_BADGE_COLORS[5]}99` } : undefined}
              className="flex min-h-[44px] flex-col items-center justify-start gap-0.5 rounded-lg px-0.5 py-1 transition-colors hover:bg-white/5"
            >
              <Star
                size={22}
                fill={filled ? '#fbbf24' : 'transparent'}
                color={filled ? '#fbbf24' : '#6b7280'}
                strokeWidth={1.5}
                aria-hidden="true"
              />
              <span
                className={`text-[11px] sm:text-xs leading-tight text-center break-words ${
                  selected ? 'text-amber-400 font-semibold' : 'text-gray-400'
                }`}
              >
                {adjective}
              </span>
            </button>
          );
        })}
      </div>
      <p id={hintId} className="mt-1 text-sm text-gray-300">{ANNOTATE.RATING_HIGHLIGHT_HINT}</p>
      {showMakeAnyway && (
        <button
          type="button"
          onClick={onMakeHighlightAnyway}
          className="mt-1 inline-flex min-h-[44px] items-center gap-1.5 text-sm text-cyan-300 hover:text-cyan-200 underline-offset-2 hover:underline"
        >
          <Sparkles size={14} />
          {ANNOTATE.MAKE_HIGHLIGHT_ANYWAY}
        </button>
      )}
    </div>
  );
}

export default PlayRatingRow;
