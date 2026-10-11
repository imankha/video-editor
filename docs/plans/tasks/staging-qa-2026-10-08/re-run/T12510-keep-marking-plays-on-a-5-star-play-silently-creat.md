# T12510: "Keep Marking Plays" on a 5-star play silently creates a highlight

**Status:** TODO
**Impact:** 6
**Complexity:** 3
**Tier:** M
**Created:** 2026-10-11
**Updated:** 2026-10-11
**Found by:** [T12310](../T12310-re-run-staging-walkthrough.md) staging re-run, finding(s) N13 (severity MED). Evidence: [RESULTS.md](../../../ux/2026-10-08-staging-qa-walkthrough/re-run/RESULTS.md) section 3; screenshots in the same folder (rr-NN-*.jpg, kept local and not committed; re-capture on staging if missing).

## Problem

The 5-star choice card says "Keep Marking Plays: Saves play in Clips so you can make your highlight later". After tapping it the app shows "Highlight moved to Clips so you can edit it later" and the Mark Plays / Frame / Spotlight tab strip appears, so a highlight was created that the user did not ask for.

Screenshots: rr-71, rr-72.

## Solution

Either say plainly on the card that a 5-star play becomes a highlight in Clips, or do not create the highlight until the user asks. Check with the user if the product intent is unclear (vocabulary: a play becomes a clip, the finished product is a highlight).

## Context

### Relevant Files (REQUIRED)

- `src/frontend/src/modes/annotate/components/HighlightChoiceCard.jsx`
- `src/frontend/src/containers/AnnotateContainer.jsx`
- `src/frontend/src/config/displayNames.js`
- `.claude/knowledge/annotate.md`

### Related Tasks

- Source: T12310. Staging QA Walkthrough milestone (README.md in the parent folder).

## Implementation

### Steps

1. [ ] Load the matching `.claude/knowledge/` doc and reproduce at the sizes named above
2. [ ] Failing behavioral test first, observe red for the intended reason
3. [ ] Implement, run the curated relevant test set and explicit lint
4. [ ] Commit with subject starting `T12510:`

## Acceptance Criteria

- [ ] The card copy matches what happens
- [ ] No highlight is created unless the copy says it will
- [ ] Test written first
