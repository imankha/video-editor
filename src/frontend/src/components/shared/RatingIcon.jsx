import { RATING_BADGE_COLORS, RATING_GLYPH_COLORS, UNRATED_BADGE_COLOR, displayRating } from './clipConstants';

/**
 * RatingIcon - the rating badge: the star count on a disc in the rating's
 * palette color (T17170; replaced the T10430 chess glyphs, which parents did
 * not read as ratings).
 *
 * A badge 28px or wider reads "4★" (list rows, the selected timeline marker);
 * a smaller timeline dot shows the digit only. Text is dark on the gold 5-star
 * face (`RATING_GLYPH_COLORS`), white elsewhere. A rating outside 1-5 is unrated:
 * neutral grey, no number. The icon carries its own "N stars" aria-label;
 * callers may add the adjective (`getRatingLabel`) as a `title` on a wrapper.
 */
const STAR_MIN_SIZE = 28;

export function RatingIcon({ rating, size = 20, className = '' }) {
  rating = displayRating(rating);
  const rated = Number.isInteger(rating) && rating >= 1 && rating <= 5;
  if (!rated) console.warn('[RatingIcon] rating outside 1-5, drawn as unrated:', rating);

  const showStar = size >= STAR_MIN_SIZE;
  const label = rated ? `${rating} star${rating === 1 ? '' : 's'}` : 'Not rated';
  return (
    <span
      role="img"
      aria-label={label}
      className={`inline-flex items-center justify-center rounded-full font-bold leading-none tabular-nums ${className}`}
      data-testid="rating-icon"
      data-rating={rating}
      style={{
        width: size,
        height: size,
        fontSize: showStar ? 13 : Math.round(size * 0.55),
        backgroundColor: rated ? RATING_BADGE_COLORS[rating] : UNRATED_BADGE_COLOR,
        color: rated ? RATING_GLYPH_COLORS[rating] : undefined,
        boxShadow: '0 1px 1.5px rgba(0,0,0,0.35)',
      }}
    >
      {rated ? `${rating}${showStar ? '★' : ''}` : ''}
    </span>
  );
}

export default RatingIcon;
