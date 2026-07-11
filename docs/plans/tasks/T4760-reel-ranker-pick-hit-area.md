# T4760: Reel Ranker "Pick this one" Button Hit Area Too Small

**Status:** STAGING
**Impact:** 5
**Complexity:** 2
**Created:** 2026-07-04
**Updated:** 2026-07-04

## Problem

In the reel ranking game, the user keeps missing the "Pick this one" button — taps that feel like they should register a pick do nothing. This is the core interaction of the ranking game (T3630), so misses are felt on every matchup.

Design context that makes this bug likely: ONLY the Pick button selects — tapping anywhere else on the clip deliberately does NOT pick (it just watches). So any tap that lands even slightly outside the button silently does nothing, which reads to the user as "I missed / the button didn't work".

## Current State (from code inspection, 2026-07-04)

Both pick buttons already meet the 44px minimum-touch-target guideline, so "make the button taller" alone is probably not the fix — the effective hit area around it is what's tight:

- `ReelMatchCard.jsx:56-68` (stacked / side-by-side mode): `w-full min-h-[44px]`, sits inside a `p-3` bottom-gradient overlay. In side-by-side portrait the card (and thus the button) can be quite narrow, and the button hugs the bottom edge of the card — near mobile browser gesture bars.
- `HeroMatchup.jsx:143-152` (hero mode): `w-full min-h-[48px]`, same bottom-overlay placement. Also has a pick gate (`disabled` for the first 3s of each clip) — a tap during the gate does nothing, which can feel like a missed tap.

## Solution

Increase the effective tap target of the pick affordance without changing the "tapping the clip does not pick" rule:

- Expand the button's hit area beyond its visual bounds (e.g. taller `min-h`, extra vertical `py`, or an invisible expanded hit zone via negative margin + padding / pseudo-element) in BOTH `ReelMatchCard` and `HeroMatchup`.
- Make the entire bottom overlay strip (the gradient area containing name + info + button) part of the pick target, OR add generous padding around the button — decide during implementation which matches the "clip tap = watch" rule best. The name/info text tap turning into a pick is acceptable only if it can't be confused with "tap to watch".
- Check bottom safe-area on mobile (`env(safe-area-inset-bottom)`) — the button sits flush against the bottom edge where OS gesture bars steal touches.
- Consider whether pick-gate taps (hero mode, disabled state) should give feedback (e.g. brief shake / "watch first" hint) instead of silently doing nothing — optional, keep scope small.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/components/ranking/ReelMatchCard.jsx` - Pick button in stacked/side-by-side mode (line ~56)
- `src/frontend/src/components/ranking/HeroMatchup.jsx` - Pick button in hero mode (line ~143) + pick gate
- `src/frontend/src/components/ranking/RankingGame.jsx` - parent layout that sizes the cards (reference only)

### Related Tasks
- T3630 (ranking game) — established the "only the Pick button selects" rule; do not change that rule, just the hit area.

### Technical Notes
- Frontend-only, no persistence, no schema change. Tier S/M.
- Test on mobile viewport widths (360-428px) in both stacked and side-by-side orientations — see the responsiveness skill.

## Implementation

### Steps
1. [ ] Reproduce on a mobile viewport: measure the effective hit rect of the Pick button in both modes
2. [ ] Expand hit area in `ReelMatchCard` and `HeroMatchup` (keep visual design; grow the touchable zone)
3. [ ] Verify bottom-edge taps aren't eaten by browser gesture bar (safe-area padding if needed)
4. [ ] Verify tapping the clip video still does NOT pick

## Acceptance Criteria

- [ ] Taps near (not just exactly on) the Pick button register a pick in both hero and both-clips modes
- [ ] Effective touch target is comfortably larger than 44px in both dimensions, including on narrow side-by-side cards
- [ ] Tapping the clip itself still only watches, never picks
- [ ] Verified on a 360-428px mobile viewport
