import { Star } from 'lucide-react';

/**
 * StarRating - 5-star rating selector
 *
 * @param {number} rating - Current rating (1-5)
 * @param {function} onRatingChange - Callback when rating changes
 * @param {number} size - Star icon size (default 18)
 */
export function StarRating({ rating, onRatingChange, size = 18 }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((starNum) => (
        <button
          key={starNum}
          onClick={() => onRatingChange(starNum)}
          className="p-0.5 hover:scale-110 transition-transform"
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
    </div>
  );
}

export default StarRating;
