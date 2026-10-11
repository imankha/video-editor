# T12550: Plain-language sweep: one word per thing, status words, rating glyphs

**Status:** TODO
**Impact:** 6
**Complexity:** 3
**Tier:** M
**Created:** 2026-10-11
**Updated:** 2026-10-11
**Found by:** [T12310](../T12310-re-run-staging-walkthrough.md) staging re-run, finding(s) N12, N21, N25, N28, N33 and RESULTS section 4 (severity MED). Evidence: [RESULTS.md](../../../ux/2026-10-08-staging-qa-walkthrough/re-run/RESULTS.md) section 3; screenshots in the same folder (rr-NN-*.jpg, kept local and not committed; re-capture on staging if missing).

## Problem

The re-run left wording problems: the spotlight step says "Moment 2 of 4" in the guide but "Frame 1 / Frame 2 (now)" in the sidebar; guide text says "Tap Generate highlight" (button: "Generate highlight with spotlight"), "Tap Share" (button: "Create share link"), "Tap Make highlight" (accessible name "Make portrait highlight"); Clips badges "Spotlight started" on a draft with no spotlight, "Draft, framed" / "Not framed", and the empty state "Give each highlight a Framing pass. Add an optional Spotlight..."; rating glyphs "!" and "!!" are unexplained; "so the spotlight stays on them" implies following; "Every clip is finished" vs plays. Copy must never claim the app frames, tracks or follows automatically.

Screenshots: rr-41b, rr-77, rr-105, rr-95, rr-63-m390-annotate-with-play, rr-40.

## Solution

Apply the proposed wording table in RESULTS.md section 4 (one word per thing, button text copied from the guide). No em dashes in UI copy. Do not redo the Parent Usability Audit renames (T11810-T11870).

## Context

### Relevant Files (REQUIRED)

- `src/frontend/src/config/displayNames.js`
- `src/frontend/src/components/instructions/FloatingCoach.jsx`

### Related Tasks

- Source: T12310. Staging QA Walkthrough milestone (README.md in the parent folder).

## Implementation

### Steps

1. [ ] Load the matching `.claude/knowledge/` doc and reproduce at the sizes named above
2. [ ] Failing behavioral test first, observe red for the intended reason
3. [ ] Implement, run the curated relevant test set and explicit lint
4. [ ] Commit with subject starting `T12550:`

## Acceptance Criteria

- [ ] Every row of RESULTS.md section 4 is applied or explicitly rejected in this file
- [ ] Guide wording equals button wording for the named buttons
- [ ] No automatic-following claim anywhere in the copy

## Evidence screenshots

Kept in `screens/T12550/` (delete that folder when this task is archived):

- [rr-105-m390-after-done-for-now.jpg](screens/T12550/rr-105-m390-after-done-for-now.jpg)
- [rr-40-overlay-start-1440.jpg](screens/T12550/rr-40-overlay-start-1440.jpg)
- [rr-41b-overlay-moment2-1440.jpg](screens/T12550/rr-41b-overlay-moment2-1440.jpg)
- [rr-63-m390-annotate-with-play.jpg](screens/T12550/rr-63-m390-annotate-with-play.jpg)
- [rr-77-clips-with-items-1440.jpg](screens/T12550/rr-77-clips-with-items-1440.jpg)
- [rr-95-annotate-cards-with-plays-1440.jpg](screens/T12550/rr-95-annotate-cards-with-plays-1440.jpg)
