import { RATING_BADGE_COLORS, RATING_NOTATION, BRILLIANT_RATING } from './clipConstants';

// Darker teal for the disc's bottom rim and the glyph drop shadow: the same
// "lit from above" treatment as the chess-style move badges the icon echoes.
const RIM = '#0E8C80';

/**
 * BrilliantIcon - the 5-star ("Brilliant", chess "!!") rating badge.
 *
 * The other four ratings stay text-on-a-rectangle; Brilliant is the only rating
 * that CREATES a clip, so it gets its own drawn icon: a solid teal disc with a
 * bold white double-exclamation built from tapered bars and rounded dots. The
 * disc uses `RATING_BADGE_COLORS[5]` so the tint/border derived everywhere
 * else from that palette still match.
 *
 * Accessibility: the SVG is decorative (`aria-hidden`); a visually hidden "!!"
 * keeps the notation in `textContent` for screen readers and for the existing
 * timeline tests that assert on it. Callers put the human label (`title` /
 * `aria-label`, via `getRatingLabel`) on the wrapper as before.
 */
export function BrilliantIcon({ size = 20, className = '' }) {
  return (
    <span className={`inline-flex items-center justify-center ${className}`} data-testid="brilliant-icon">
      <svg
        width={size}
        height={size}
        viewBox="0 0 64 64"
        aria-hidden="true"
        focusable="false"
        style={{ display: 'block', filter: 'drop-shadow(0 1px 1.5px rgba(0,0,0,0.35))' }}
      >
        {/* Disc: darker rim peeking out below the lit face */}
        <circle cx="32" cy="34" r="30" fill={RIM} />
        <circle cx="32" cy="31" r="30" fill={RATING_BADGE_COLORS[BRILLIANT_RATING]} />
        {/* Glyph drop shadow (same shapes, pushed down, rim color) */}
        <g fill={RIM} stroke={RIM} strokeWidth="3" strokeLinejoin="round" transform="translate(0 2.5)">
          <path d="M18.5 11.5H29.5L28 35.5H20Z" />
          <rect x="19.5" y="41.5" width="9" height="9" rx="2" />
          <path d="M34.5 11.5H45.5L44 35.5H36Z" />
          <rect x="35.5" y="41.5" width="9" height="9" rx="2" />
        </g>
        {/* The "!!" itself: tapered bars + rounded square dots */}
        <g fill="#ffffff" stroke="#ffffff" strokeWidth="3" strokeLinejoin="round">
          <path d="M18.5 11.5H29.5L28 35.5H20Z" />
          <rect x="19.5" y="41.5" width="9" height="9" rx="2" />
          <path d="M34.5 11.5H45.5L44 35.5H36Z" />
          <rect x="35.5" y="41.5" width="9" height="9" rx="2" />
        </g>
      </svg>
      <span className="sr-only">{RATING_NOTATION[BRILLIANT_RATING]}</span>
    </span>
  );
}

export default BrilliantIcon;
