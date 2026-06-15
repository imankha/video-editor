import React from 'react';

// Below this, the gauge reads "low" and goes amber to nudge the user to rank.
const LOW_CONFIDENCE_PCT = 50;
const COLOR_LOW = '#f59e0b';   // amber-500 (needs love)
const COLOR_OK = '#22d3ee';    // cyan-400

/**
 * ConfidenceGauge - a fuel-gauge-style confidence meter (T3630). A semicircular
 * track from E (empty) to F (full) with a needle at `pct`. The arc/needle go
 * amber under 50% (nudge to rank) and cyan at/above. Purely presentational SVG;
 * the needle animates via CSS transition.
 *
 * @param {number}   pct       - 0..100
 * @param {string=}  color     - override the auto (amber<50 / cyan>=50) stroke
 * @param {number=}  width     - px (default 132); ignored when `fill` is set
 * @param {boolean=} fill      - scale to the container instead of a fixed width
 *                               (the SVG keeps its 120:78 ratio, centered)
 * @param {string=}  className - extra classes on the <svg> (sizing in fill mode)
 */
export function ConfidenceGauge({ pct, color, width = 132, fill = false, className = '' }) {
  const clamped = Math.max(0, Math.min(100, pct || 0));
  const p = clamped / 100;
  const stroke = color || (clamped < LOW_CONFIDENCE_PCT ? COLOR_LOW : COLOR_OK);
  const cx = 60, cy = 60, r = 50;
  // theta: pi (left/E) -> 0 (right/F)
  const theta = Math.PI * (1 - p);
  const ex = cx + r * Math.cos(theta);
  const ey = cy - r * Math.sin(theta);
  const nx = cx + (r - 8) * Math.cos(theta);
  const ny = cy - (r - 8) * Math.sin(theta);

  // Drawn in viewBox units, so it scales uniformly at any rendered size.
  const arc = (
    <>
      {/* Track */}
      <path d="M10 60 A 50 50 0 0 1 110 60" fill="none" stroke="#374151"
            strokeWidth="8" strokeLinecap="round" />
      {/* Value arc */}
      <path d={`M10 60 A 50 50 0 0 1 ${ex.toFixed(2)} ${ey.toFixed(2)}`} fill="none"
            stroke={stroke} strokeWidth="8" strokeLinecap="round"
            style={{ transition: 'all 0.5s ease' }} />
      {/* Needle */}
      <line x1={cx} y1={cy} x2={nx.toFixed(2)} y2={ny.toFixed(2)}
            stroke={stroke} strokeWidth="2.5" strokeLinecap="round"
            style={{ transition: 'all 0.5s ease' }} />
      <circle cx={cx} cy={cy} r="4" fill={stroke} />
      {/* E / F labels */}
      <text x="8" y="74" fontSize="11" fill="#9ca3af" textAnchor="middle">E</text>
      <text x="112" y="74" fontSize="11" fill="#9ca3af" textAnchor="middle">F</text>
    </>
  );

  // Fill mode: the container sizes it (height-driven via aspect-ratio); the
  // semicircle scales to fit, centered. Used by the in-game meter to grow into
  // the available space.
  if (fill) {
    return (
      <svg viewBox="0 0 120 78" preserveAspectRatio="xMidYMid meet"
           className={`block ${className}`} style={{ aspectRatio: '120 / 78' }}>
        {arc}
      </svg>
    );
  }

  const height = Math.round((width * 78) / 120); // preserve the 120x78 viewBox ratio
  return (
    <svg width={width} height={height} viewBox="0 0 120 78" className={`block ${className}`}>
      {arc}
    </svg>
  );
}

export default ConfidenceGauge;
