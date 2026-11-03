# T14520: Auto-tracking and AI-focus overclaims

**Status:** WIP
**Impact:** 7
**Complexity:** 2
**Created:** 2026-11-03
**Updated:** 2026-11-03

## Problem

Product rule: the parent frames and picks the athlete; the AI proposes boxes and upscales. It
never tracks, follows or frames on its own. Live copy breaks this:

- Landing testimonials: "Really tracked well." and "Wow, does the app simulate the camera focusing on my son?" (`src/landing/src/data/testimonials.ts:42,47`)
- Landing hero subline: "Any video source. You frame your athlete; AI focus smooths, spotlights and upscales." (`src/landing/src/site.ts:36`). The AI does not place the spotlight, and "Focus" is a retired name.
- Landing "In focus" before/after label (`src/landing/src/pages/index.astro` ~173) and "keeping a chosen player in frame" (`src/landing/src/pages/about.astro` ~100)
- App: "Player tracking disabled" (`src/frontend/src/modes/overlay/layers/DetectionMarkerLayer.jsx:110`), "Detecting players..." (`PlayerDetectionOverlay.jsx` ~111), "Player detection" listed as always free (`src/frontend/src/components/BuyCreditsModal.jsx` ~129)

Found by the 2026-11-03 copy audit (reports C, D, E in [copy-vocabulary/audit/](copy-vocabulary/audit/)).

## Solution

- Testimonials: drop the two quotes, or replace with quotes that describe the parent framing
  (they are real user quotes, so do not edit their words).
- Hero subline: "You frame your athlete and place the spotlight. AI smooths the motion and upscales." (or similar; no "AI focus").
- App strings: describe what the parent does ("Finding athletes...", "Tap your athlete"); remove "tracking".
- About page: "you set the frame, the app fills in the motion between your positions".

## Context

### Relevant Files
- `src/landing/src/data/testimonials.ts`, `src/landing/src/site.ts`, `src/landing/src/pages/index.astro`, `src/landing/src/pages/about.astro`
- `src/frontend/src/modes/overlay/layers/DetectionMarkerLayer.jsx`, `src/frontend/src/modes/overlay/overlays/PlayerDetectionOverlay.jsx`, `src/frontend/src/components/BuyCreditsModal.jsx`

### Related Tasks
- T14650 (landing vocabulary) reworks landing copy more broadly; this task fixes only the overclaims and ships first.

## Implementation

1. [ ] Failing test(s) on the app strings (e.g. no "tracking" in the detection layer title)
2. [ ] Fix the app strings; move them to `displayNames.js`
3. [ ] Fix the landing strings; landing build
4. [ ] Grep the landing site and app for `track`, `follows`, `automatically`, `AI focus` and fix any other overclaim found

## Acceptance Criteria

- [ ] No user copy claims the AI tracks, follows, focuses or frames on its own
- [ ] Testimonial wording is never altered (dropped or replaced only)
- [ ] Tests pass; landing builds
