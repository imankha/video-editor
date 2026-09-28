import { useEffect, useId, useRef, useState } from 'react';
import { Star, X } from 'lucide-react';
import { ANNOTATE } from '../../../config/displayNames';
import { RATING_ADJECTIVES, getRatingLabel } from '../../../components/shared/clipConstants';

const RATING_VALUES = [5, 4, 3, 2, 1];

/**
 * RatingPill (T11150) — the play editor's rating control, replacing the old
 * T10410 RatingBadge (chess-notation disc + "Required"/amber-dashed to-do
 * treatment). A normal labeled pill: neutral slate when unrated (no amber, no
 * dashed border, no "Required" copy — rating is optional, not a checklist
 * item), amber-starred with the rating's adjective once set, and a gold pill
 * (T11110's RATING_BADGE_COLORS[5]) at a 5-star rating specifically — reusing
 * the shipped gold, not inventing a new color.
 *
 * The popup ("meanings list") is adapted from the old RatingBadge: five rows,
 * best-first (5 -> 1), each showing the amber star row + RATING_ADJECTIVES.
 * NO chess RATING_NOTATION anywhere on the pill or its rows (dropped per the
 * H12A=A2 ruling). Mobile renders a bottom sheet (explicit X, no
 * backdrop-close — the standing project rule); desktop an anchored dropdown.
 * The Escape handler lives on `document` with `stopPropagation()` so it
 * doesn't also trip the editor's own window-level Escape handler on the same
 * keypress (T10590 landmine, preserved here).
 */
export function RatingPill({ rating, onRatingChange, myAthlete, isMobile }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const headingId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const onKeyDown = (e) => {
      if (e.key !== 'Escape') return;
      // T10590 (preserved): stopPropagation so this Escape doesn't also reach
      // AnnotateFullscreenOverlay's window-level Escape handler, which would
      // otherwise close the whole editor on the same keypress that just
      // closed this picker.
      e.stopPropagation();
      setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const pickerTitle = myAthlete ? ANNOTATE.RATE_ATHLETES_PLAY : ANNOTATE.RATE_TEAMS_PLAY;
  const rated = rating != null;
  const pillTitle = rated ? getRatingLabel(rating) : ANNOTATE.RATE_PLAY;
  const gold = rated && rating === 5;

  const pillClass = gold
    ? 'border-[#F5B700]/50 bg-[#F5B700]/15 text-[#F5B700]'
    : rated
      ? 'border-gray-600 bg-gray-800 text-amber-300'
      : 'border-gray-600 bg-gray-800 text-gray-300';

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        data-testid="rating-pill"
        data-state={rated ? 'rated' : 'unrated'}
        data-rating={rating ?? ''}
        title={pillTitle}
        aria-label={pillTitle}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-sm font-medium transition-colors coarse-pointer:min-h-[44px] ${pillClass}`}
      >
        <Star
          size={14}
          fill={rated ? '#fbbf24' : 'transparent'}
          color={rated ? '#fbbf24' : '#9ca3af'}
          strokeWidth={1.5}
        />
        {rated ? RATING_ADJECTIVES[rating] : ANNOTATE.RATE_PLAY}
      </button>
      {open && (
        <div
          role="presentation"
          className={
            isMobile
              ? 'fixed inset-0 z-50 flex items-end justify-center bg-black/60'
              : 'absolute z-50 top-full left-0 mt-2'
          }
        >
          <div
            data-testid="rating-picker"
            className={
              isMobile
                ? 'w-full pb-[max(0.5rem,env(safe-area-inset-bottom))] rounded-t-2xl p-2 border border-gray-700 bg-gray-800 shadow-xl'
                : 'w-auto min-w-[190px] pb-2 rounded-xl p-2 border border-gray-700 bg-gray-800 shadow-xl'
            }
          >
            {isMobile ? (
              <>
                <div aria-hidden="true" className="mx-auto mb-2 mt-1 h-1 w-10 rounded-full bg-gray-600" />
                <div className="flex items-start justify-between gap-2 px-1.5 pt-1 pb-2.5">
                  <div id={headingId} className="text-lg font-bold text-white">{pickerTitle}</div>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    aria-label="Close"
                    className="shrink-0 p-1 -m-1 rounded text-gray-400 hover:text-white hover:bg-gray-700/70 coarse-pointer:min-h-[44px] coarse-pointer:min-w-[44px]"
                  >
                    <X size={18} />
                  </button>
                </div>
              </>
            ) : (
              <div id={headingId} className="px-1.5 pt-1 pb-2.5 text-lg font-bold text-white">{pickerTitle}</div>
            )}
            <div role="radiogroup" aria-labelledby={headingId} className="flex flex-col gap-1">
              {RATING_VALUES.map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={rating === value}
                  aria-label={`${value} star${value > 1 ? 's' : ''} - ${RATING_ADJECTIVES[value]}`}
                  onClick={() => {
                    onRatingChange(value);
                    setOpen(false);
                  }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm whitespace-nowrap
                              coarse-pointer:min-h-[44px] coarse-pointer:py-3 transition-colors ${
                    rating === value
                      ? 'bg-gray-700 text-white'
                      : 'text-gray-300 hover:bg-gray-700/70 hover:text-white'
                  }`}
                >
                  <span className="flex items-center gap-0.5 shrink-0">
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
                  {RATING_ADJECTIVES[value]}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default RatingPill;
