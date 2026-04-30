# T2300: Visual Foundation & Design System

**Status:** TODO
**Impact:** 7
**Complexity:** 3
**Created:** 2026-04-30
**Updated:** 2026-04-30

## Problem

The current landing page uses saturated purple gradients that feel "gamer" rather than premium. Purple-on-purple feature tiles look monotone. No design system enforces consistency across sections. The accent color doesn't pop against the background for CTAs.

## Solution

Establish the visual foundation that all other tasks build on: color palette, accent color, typography, and background treatment.

### Color Palette

- **Background:** Deep dark navy or near-black (desaturated from current purple). Reference: late-evening match sky, not stage lighting. Subtle gradient allowed but less purple than current.
- **Accent color (CTAs + highlights):** One of:
  - Field green (`#00C853`) -- soccer-coded, clean
  - Sharp orange (`#FF6B35`) -- energetic, IG/TikTok energy
  - Electric cyan (`#00E5FF`) -- tech-forward, distinctive
- **One accent everywhere:** Every CTA, highlight, focus state uses the same accent. No gradients on buttons.
- **Optional:** Faint tactical pitch-line pattern at 3% opacity in hero background.

### Typography

- **Display font:** Geometric sans with personality. Candidates: *General Sans*, *Sohne*, *Druk Wide* (headlines only). Not Inter.
- **Body font:** Inter, IBM Plex Sans, or system stack.
- **Treatment:** Tight tracking on headlines, tighter line-height than default.

### Imagery Rules

- Every person image is a real player in a real kit on a real pitch. No stock photography.
- Slight desaturation across all imagery for cohesion.
- Player illustrations (feature icons) are silhouettes, not detailed renderings.

## Context

### Relevant Files
- `src/landing/tailwind.config.js` -- color palette, font config
- `src/landing/src/index.css` -- global styles, Tailwind directives
- `src/landing/src/App.tsx` -- inline color classes to update
- `src/landing/index.html` -- font imports, meta theme-color

### Related Tasks
- Blocks: All other tasks in this epic (T2310-T2380)

## Implementation

1. [ ] Choose accent color (decision required from user)
2. [ ] Set up display font (Google Fonts or self-hosted)
3. [ ] Update `tailwind.config.js` with new color palette and font families
4. [ ] Update `index.css` with base styles (background, text colors, focus states)
5. [ ] Update `index.html` with font imports and meta theme-color
6. [ ] Define reusable Tailwind classes for CTA buttons (primary, secondary, text link)
7. [ ] Remove current purple gradient backgrounds

## Acceptance Criteria

- [ ] Background is deep navy/near-black, not saturated purple
- [ ] Single bright accent color used for all interactive elements
- [ ] Display font loaded and applied to headlines
- [ ] CTA button styles defined and reusable
- [ ] No purple-on-purple monotone sections remain
