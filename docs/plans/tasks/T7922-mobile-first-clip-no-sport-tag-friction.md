# T7922: First mobile clip — no_sport Tags block is a dead-feeling prompt, not tags

**Status:** WAITING ON USER
**Impact:** 5
**Complexity:** 3
**Created:** 2026-08-28 (filed from the T7920 mobile clip-save live-drive audit)

## Problem

Since T7850 every NEW profile defaults to `sport = 'no_sport'` (never chosen). The T7920
live-drive audit confirmed that the mobile Add Clip form itself is functionally clean — the
form is reachable at 320px, the T7540 tag-trap fix holds, Save round-trips to a real
`raw_clips` row, and the T7510 counters fire. But it also surfaced the most plausible product
reason a brand-new mobile user opens Add Clip and saves nothing:

For a `no_sport` profile the Add Clip **Tags** section renders only the amber
`<NoSportTagWarning>` ("Set your sport (top bar) for tags") — there are NO tappable tags. So at
the exact moment a first-time user would tag their first clip, the primary affordance is an
instruction to go elsewhere (the top-bar sport picker) rather than something to act on. This is
a friction / dead-feeling step, not a bug — the form saves fine without a tag — but it plausibly
explains the "open form, save nothing, leave" pattern (mostafaali452010, 2026-08-27) for the new
mobile cohort that T7850 made all-`no_sport`.

Evidence (from T7920, `qa/`): `criterion-3-nosport-warning-320x568.png`,
`criterion-3-nosport-warning-375x667.png`, `criterion-3-nosport-warning-compact-landscape-667x375.png`.

## Solution (to be designed — do NOT assume this shape)

This is a UX/design question, not a mechanical fix. Candidate directions to weigh:
- Make `<NoSportTagWarning>` actionable — tap it to open the sport picker inline (today it is
  deliberately instructional-only, "names the header path rather than adding new nav plumbing",
  per T7850) so the user can set their sport and get tags without leaving the form.
- Prompt for sport earlier (first upload / onboarding) so the first Add Clip already has a tag set.
- Let the user save a first clip with a rating only and nudge sport selection non-blockingly.

Design gate required (real tradeoffs: onboarding flow, T7850's deliberate no-nav decision,
mobile top-bar reachability). Pair with the T7640 Tutorial Redesign real-device pass.

## Context

### Relevant Files
- `src/frontend/src/components/shared/NoSportTagWarning.jsx` (full + `compact` variants)
- `src/frontend/src/modes/annotate/components/AnnotateFullscreenOverlay.jsx` (mobile Add Clip form)
- `src/frontend/src/components/ClipDetailsEditor.jsx`, `UploadClipModal.jsx` (other NoSportTagWarning call sites)
- Sport sentinel + registry: `src/frontend/src/modes/annotate/constants/tagRegistry.js` (`NO_SPORT`)

### Related Tasks
- Root: T7850 (no_sport default + NoSportTagWarning)
- Surfaced by: T7920 (mobile clip-save audit — form itself verified clean)
- Overlaps: T7640 Tutorial Redesign (real-device onboarding pass)

## Acceptance Criteria

- [x] A first-time mobile `no_sport` user can reach a tag set (or a deliberate no-tag save) from
      the Add Clip form without a dead-feeling detour, verified on a mobile viewport with evidence
- [x] T7850's "instructional-only, no new nav plumbing" decision is explicitly revisited or upheld
      in the design doc
