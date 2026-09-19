import { Star } from 'lucide-react';
import { getRatingLabel } from './clipConstants';

/**
 * StarRating - 5-star rating selector
 *
 * @param {number} rating - Current rating (1-5)
 * @param {function} onRatingChange - Callback when rating changes
 * @param {number} size - Star icon size (default 18)
 * @param {boolean} showLabel - T9830: opt-in canonical descriptor label
 *   (`getRatingLabel(rating)`, e.g. "4 stars · Good", T9630 N35) rendered beside
 *   the stars. The Annotate editor's rating (now an optional detail) turns this
 *   on so the label reads identically everywhere; UploadClipModal keeps the bare
 *   star row (default off) — no behavior change for the pre-existing consumer.
 */
export function StarRating({ rating, onRatingChange, size = 18, showLabel = false }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((starNum) => (
        <button
          key={starNum}
          onClick={() => onRatingChange(starNum)}
          className="p-0.5 coarse-pointer:min-w-[44px] coarse-pointer:min-h-[44px] coarse-pointer:flex coarse-pointer:items-center coarse-pointer:justify-center hover:scale-110 transition-transform"
          title={`${starNum} star${starNum > 1 ? 's' : ''}`}
          type="button"
        >
          <Star
            size={size}
            fill={starNum <= rating ? '#fbbf24' : 'transparent'}
            color={starNum <= rating ? '#fbbf24' : '#6b7280'}
            strokeWidth={1.5}
          />
        </button>
      ))}
      {showLabel && (
        <span
          className="ml-2 text-sm font-bold text-white"
          title={getRatingLabel(rating)}
          aria-label={getRatingLabel(rating)}
        >
          {getRatingLabel(rating)}
        </span>
      )}
    </div>
  );
}

export default StarRating;
