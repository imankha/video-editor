# T12700: Leftovers from T12570 and copy nits seen on the 2026-10-12 walk

**Status:** STAGING
**Impact:** 3
**Complexity:** 3
**Tier:** S
**Created:** 2026-10-12
**Updated:** 2026-10-12
**Found by:** [T12590](../T12590-guide-coverage-and-responsive-sweep.md) live staging walk 2026-10-12 (severity LOW). Evidence: [T12590 RESULTS](../../ux/2026-10-11-guide-coverage-sweep/RESULTS.md); screenshots in `docs/plans/ux/2026-10-11-guide-coverage-sweep/screens/`.

## Problem

Still open on staging: tap targets under 44 px at 320 to 768 (guide X 28x28, Annotate clip-count chip 51x34, speed "1x" 39x32, "Report a problem" 108x20 at 390, Finished viewer Share and Download 32 px high, game type buttons 36 px); locked Finished gauges use a box glyph that reads as a missing character; the Share modal tiles show an empty circle where an icon belongs; the Google sign-in button is wider than the card fields at 390 ([signin-390](../../ux/2026-10-11-guide-coverage-sweep/screens/signin-390.jpg)).

The Focus ready panel tile "Finish without spotlight" still truncates its subtitle ("Only you can see it until you...") at 1440.

Copy: the spotlight hint reads "Tap the spotlight to adjust it, or hide tracking to edit freely" (in the app it uses an em dash, and "tracking" suggests the app follows the athlete); the Finished viewer guide says "Get share link" while the button says "Create share link". The sport chosen in the upload modal did not stick in this walk ("Pick sport" stayed in the header and "What sport is this?" appeared at the first play), though it was set by a scripted file pick, so confirm with a real tap.

## Solution

Fix in one sweep; re-measure the 44 px rule at 320, 360, 375, 390 and 768 on touch.

## Context

### Relevant Files (REQUIRED)

- `src/frontend/src/components/instructions/InstructionCoach.jsx`
- `src/frontend/src/components/GameDetailsModal.jsx`

### Related Tasks

- Source: T12590 (this walk), T12580 (shaded guide steps), T12570 (polish bundle).

## Implementation

### Steps

1. [ ] Load the matching `.claude/knowledge/` doc and reproduce at the sizes named above
2. [ ] Failing behavioral test first, observe red for the intended reason
3. [ ] Implement, run the curated relevant test set and explicit lint
4. [ ] Commit with subject starting `T12700:`

## Acceptance Criteria

- [ ] Each observation above is fixed, or recorded as not reproducible with a screenshot
- [ ] Re-checked on staging at 1440x900, 1024x768, 768x1024 and 390x844
