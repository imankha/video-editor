// T5215 round 2 — the ONE glyph + colour that means "an intro plays here",
// shared between the reel thumbnail badge (ReelTile) and the intro picker's
// selection marker (IntroCardCarousel). Import from here in BOTH places;
// never hardcode a second copy of the icon or the colour class — a drift
// between the two surfaces defeats the entire point (user, 2026-08-06:
// "that icon and color should appear on the intro selector to make the
// mental connection"). Purple/violet is already this feature's accent
// elsewhere (the consent checkbox + focus rings in ProfileIntroSection.jsx),
// so it reads as "intro" rather than colliding with an unrelated meaning.
//
// Round 4 (user, 2026-08-07): "a little intro card icon (maybe a box the
// shape of the aspect ratio with a face silhouette inside)" — swapped the
// generic Sparkles for a purpose-built glyph (components/shared/IntroCardIcon).
// Only the glyph changed here; every call site picks it up automatically.

import { IntroCardIcon } from '../components/shared/IntroCardIcon';

export const INTRO_BADGE_ICON = IntroCardIcon;

// Every value is a COMPLETE Tailwind class string on purpose (mirrors
// constants/zLayers.js's own rule) — Tailwind's JIT scanner only generates
// classes it can see literally in source; `${INTRO_BADGE.border}/50` would
// NOT be picked up, so every opacity variant a caller needs gets its OWN
// full token here rather than being built at runtime.
export const INTRO_BADGE = {
  text: 'text-purple-300',
  bg: 'bg-purple-500',
  bgSolid: 'bg-purple-600',
  border: 'border-purple-500',
  ring: 'ring-purple-400',
};
