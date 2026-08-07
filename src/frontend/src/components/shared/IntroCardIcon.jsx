// T5215 round 4 -- the intro badge glyph. User, 2026-08-07: "a little intro
// card icon (maybe a box the shape of the aspect ratio with a face
// silhouette inside)", replacing the generic lucide Sparkles this badge
// started with (round 2/3). A small hand-rolled SVG, same pattern as Logo.jsx
// (viewBox + literal paths, no icon library shape fits this). The viewBox is
// a 9:16 portrait card -- the more common aspect -- so the shape itself
// reads as "a card", not just a badge dot.
//
// Matches lucide's icon prop contract (size/className/...rest passthrough)
// so it drops into every existing <IntroIcon .../> call site (constants/
// introBadge.js's INTRO_BADGE_ICON) without touching ReelTile/CollectionHeader/
// IntroCardCarousel/MenuItem -- they all just render whatever this exports.
export function IntroCardIcon({ size = 16, className = '', fill = 'currentColor', ...rest }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 14 24"
      className={className}
      {...rest}
    >
      {/* card frame */}
      <rect x="1" y="1" width="12" height="22" rx="2.5" fill="none" stroke={fill} strokeWidth="1.5" />
      {/* face silhouette: head + shoulders */}
      <circle cx="7" cy="9.5" r="3" fill={fill} />
      <path d="M1.8 20.5C1.8 16.5 4 14.5 7 14.5C10 14.5 12.2 16.5 12.2 20.5Z" fill={fill} />
    </svg>
  );
}

export default IntroCardIcon;
