import { RATING_BADGE_COLORS, RATING_NOTATION, RATING_GLYPH_COLORS, UNRATED_BADGE_COLOR } from './clipConstants';

/**
 * RatingIcon - the rating badge as a drawn disc icon (T10430).
 *
 * Every rating renders as a solid disc in its palette color with its chess-style
 * notation drawn as SVG shapes (tapered bars, hooks, rounded dots), a darker
 * bottom rim and a glyph drop shadow, so the badge reads at 18px as well as at
 * 160px. Ratings 1-5 map to ??, ?, !?, !, !! (`RATING_NOTATION`). T11110:
 * Highlight (5) is gold; its notation glyph is drawn dark (`RATING_GLYPH_COLORS`)
 * for contrast, since white on gold is illegible. The other faces keep a white
 * glyph.
 *
 * Accessibility: the SVG is decorative (`aria-hidden`); a visually hidden copy
 * of the notation keeps it in `textContent` for screen readers and for tests
 * that assert on it. Callers put the human label (`title` / `aria-label`, via
 * `getRatingLabel`) on the wrapper.
 */

// Darker shade of a hex color for the disc rim and glyph shadow (lit from above).
function darken(hex, factor = 0.72) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (shift) => Math.round(((n >> shift) & 0xff) * factor);
  return `#${[16, 8, 0].map((s) => ch(s).toString(16).padStart(2, '0')).join('')}`;
}

// Glyphs are drawn in a 64x64 box, each centered on `cx`. A lone glyph sits at
// 32; a pair sits at 24 and 40. The stroke on the fills rounds the corners.
function Exclamation({ cx }) {
  return (
    <>
      <path d={`M${cx - 5.5} 11.5H${cx + 5.5}L${cx + 4} 35.5H${cx - 4}Z`} />
      <rect x={cx - 4.5} y="41.5" width="9" height="9" rx="2" />
    </>
  );
}

function Question({ cx }) {
  return (
    <>
      <path
        d={`M${cx - 8} 20.5A8.5 8.5 0 1 1 ${cx + 3.5} 27.5Q${cx} 30 ${cx} 35.5`}
        fill="none"
        strokeWidth="7"
        strokeLinecap="round"
      />
      <rect x={cx - 4.5} y="41.5" width="9" height="9" rx="2" />
    </>
  );
}

const GLYPHS = {
  1: () => <><Question cx={24} /><Question cx={40} /></>,
  2: () => <Question cx={32} />,
  3: () => <><Exclamation cx={24} /><Question cx={40} /></>,
  4: () => <Exclamation cx={32} />,
  5: () => <><Exclamation cx={24} /><Exclamation cx={40} /></>,
};

// T10690: rating === null is a real "not rated" state, not an anomaly — render
// a dedicated unrated disc (dashed neutral ring, transparent face, no glyph)
// instead of falling back to a fake star. One definition, inherited by every
// RatingIcon consumer.
function UnratedDisc({ size, className }) {
  return (
    <span
      className={`relative inline-flex items-center justify-center ${className}`}
      data-testid="rating-icon"
      data-rating="unrated"
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 64 64"
        aria-hidden="true"
        focusable="false"
        style={{ display: 'block' }}
      >
        <circle cx="32" cy="32" r="27" fill="transparent" stroke={UNRATED_BADGE_COLOR} strokeWidth="4" strokeDasharray="7 6" />
      </svg>
      <span className="sr-only">Not rated</span>
    </span>
  );
}

export function RatingIcon({ rating, size = 20, className = '' }) {
  if (rating == null) return <UnratedDisc size={size} className={className} />;

  const face = RATING_BADGE_COLORS[rating];
  const rim = darken(face);
  const glyph = RATING_GLYPH_COLORS[rating];
  const Glyph = GLYPHS[rating];
  return (
    // `relative`: the sr-only label below is position:absolute; without a
    // positioned ancestor its containing block is the viewport, so it escapes
    // the app shell's overflow-hidden and every off-screen clip-list row's icon
    // extended the DOCUMENT, letting the page scroll past the UI (T10910).
    <span
      className={`relative inline-flex items-center justify-center ${className}`}
      data-testid="rating-icon"
      data-rating={rating}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 64 64"
        aria-hidden="true"
        focusable="false"
        style={{ display: 'block', filter: 'drop-shadow(0 1px 1.5px rgba(0,0,0,0.35))' }}
      >
        {/* Disc: darker rim peeking out below the lit face */}
        <circle cx="32" cy="34" r="30" fill={rim} />
        <circle cx="32" cy="31" r="30" fill={face} />
        {/* Glyph drop shadow (same shapes, pushed down, rim color) */}
        <g fill={rim} stroke={rim} strokeWidth="3" strokeLinejoin="round" transform="translate(0 2.5)">
          <Glyph />
        </g>
        {/* The notation itself (dark on gold, white elsewhere — RATING_GLYPH_COLORS) */}
        <g fill={glyph} stroke={glyph} strokeWidth="3" strokeLinejoin="round">
          <Glyph />
        </g>
      </svg>
      <span className="sr-only">{RATING_NOTATION[rating]}</span>
    </span>
  );
}

export default RatingIcon;
