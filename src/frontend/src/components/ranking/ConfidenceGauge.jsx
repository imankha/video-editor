import React from 'react';

/**
 * ConfidenceGauge - a fuel-gauge-style confidence meter (T3630). A semicircular
 * track from E (empty) to F (full) with a needle at `pct` and the % in the
 * center. Purely presentational SVG; the needle animates via CSS transition.
 *
 * @param {number}  pct    - 0..100
 * @param {string=} color  - arc/needle stroke (default cyan)
 * @param {number=} width  - px (default 132)
 */
export function ConfidenceGauge({ pct, color = '#22d3ee', width = 132 }) {
  const p = Math.max(0, Math.min(100, pct || 0)) / 100;
  const cx = 60, cy = 60, r = 50;
  // theta: pi (left/E) -> 0 (right/F)
  const theta = Math.PI * (1 - p);
  const ex = cx + r * Math.cos(theta);
  const ey = cy - r * Math.sin(theta);
  const nx = cx + (r - 8) * Math.cos(theta);
  const ny = cy - (r - 8) * Math.sin(theta);
  const height = Math.round((width * 78) / 120); // preserve the 120x78 viewBox ratio

  return (
    <svg width={width} height={height} viewBox="0 0 120 78" className="block">
      {/* Track */}
      <path d="M10 60 A 50 50 0 0 1 110 60" fill="none" stroke="#374151"
            strokeWidth="8" strokeLinecap="round" />
      {/* Value arc */}
      <path d={`M10 60 A 50 50 0 0 1 ${ex.toFixed(2)} ${ey.toFixed(2)}`} fill="none"
            stroke={color} strokeWidth="8" strokeLinecap="round"
            style={{ transition: 'all 0.5s ease' }} />
      {/* Needle */}
      <line x1={cx} y1={cy} x2={nx.toFixed(2)} y2={ny.toFixed(2)}
            stroke={color} strokeWidth="2.5" strokeLinecap="round"
            style={{ transition: 'all 0.5s ease' }} />
      <circle cx={cx} cy={cy} r="4" fill={color} />
      {/* E / F labels */}
      <text x="8" y="74" fontSize="10" fill="#9ca3af" textAnchor="middle">E</text>
      <text x="112" y="74" fontSize="10" fill="#9ca3af" textAnchor="middle">F</text>
      {/* Percentage */}
      <text x="60" y="52" fontSize="20" fontWeight="700" fill={color} textAnchor="middle">
        {Math.round(pct || 0)}%
      </text>
    </svg>
  );
}

export default ConfidenceGauge;
