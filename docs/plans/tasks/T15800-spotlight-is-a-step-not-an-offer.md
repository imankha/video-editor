# T15800: Spotlight is a step on the way to Finished, not an offer

**Status:** TODO
**Impact:** 9
**Complexity:** 4
**Created:** 2026-11-09
**Updated:** 2026-11-09
**Milestone:** Roadmap 2, Spotlight first (see PLAN.md)

## Source

Prod evidence 2026-11-09 ([funnel-evidence-2026-11-09.md](../bi/funnel-evidence-2026-11-09.md)): of
39 users who paid for a highlight on their sign-up day, the 13 who also exported Spotlight produced
2 of the 2 seven-day returners, 3 of the 4 repeat highlights and all 3 payers; the 26 who sharpened
and stopped produced none. Only 12 of those 26 were ever offered Spotlight (`overlay_offered`),
3 opened it, 4 deferred it, and 16 were mobile-only. All time: 22 Spotlight exporters gave 5 returners
and 5 payers; 30 no-Spotlight payers gave 2 returners and 0 payers. The owner's theory ("a user who
exports and uses Frame and Spotlight correctly sees the value and comes back") holds for the Spotlight
half and fails for the Frame-only half.

## Problem

Spotlight is offered as a preview after the Frame export (`focusCompletionOffer.js` records
`overlay_offered` only when a preview URL resolves), is easy to defer, and on phones runs into the
layout bugs filed 2026-11-09 (T15470, T15740). The product people pay for and return to is the
spotlighted highlight; the flow treats it as optional.

## Solution

1. After Make highlight completes, the next screen is Spotlight with the athlete pre-detected, not a
   preview with an offer. "Finish without spotlight" stays as a secondary action (T15420 fixes its
   stale-toast bug). No new credit charge (Spotlight render is free by product decision).
2. The Frame result preview (T9285 path) is folded into Spotlight's first frame: the parent sees the
   sharpened clip with the ellipse on their athlete and taps Finish, or adjusts.
3. Mobile first: the Spotlight screen must pass the 390 px portrait and iPad checks from T15470 /
   T15740 before this ships; those rows are prerequisites, not part of this task.
4. Measurement: the admin Journey gets "Spotlight done" as the edge between Pressed Make highlight and
   Highlight made (T14720 keys stay frozen; this is a new non-major stage from the existing
   `overlay_exported` event). The gate for this section is Spotlight-complete out of paid highlights.

Copy follows the glossary: the circle is always "spotlight"; the step name says the parent's goal
(T14780 decides the exact word).

## Acceptance Criteria

- [ ] Every completed Make highlight opens Spotlight next, on desktop and phone; `overlay_offered` fires for 100% of `credits_consumed` users in a staging walk-through (empty preset, phone 390x844 and desktop 1280x800).
- [ ] "Finish without spotlight" is reachable but secondary, and the resulting highlight is the sharpened clip (T15420 regression test passes).
- [ ] The admin Journey shows a Spotlight-done edge sourced from `overlay_exported`, with its instrumented-at date.
- [ ] Vitest for the completion routing; Playwright for the phone and desktop paths.

## Context

### Related Tasks
T15470, T15740 (mobile Spotlight layout, prerequisites), T15420, T14770 (one Make highlight button),
T14780 (step names), T14630 (Spotlight copy), T9285 (completion preview), T15810 (Finished hub).

### Relevant Files (REQUIRED)
- `src/frontend/src/screens/FocusScreen.jsx`
- `src/frontend/src/screens/focusCompletionOffer.js`
- `src/frontend/src/utils/resumeFocusCompletion.js`
- `src/frontend/src/screens/OverlayScreen.jsx`
- `src/frontend/src/components/DraftReelPreview.jsx`
- `src/backend/app/analytics.py` (stage keys, `EVENT_INSTRUMENTED_AT`)
- `src/frontend/src/components/admin/journeyTargets.js`
