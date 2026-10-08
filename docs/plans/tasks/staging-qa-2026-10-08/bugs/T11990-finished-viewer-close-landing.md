# T11990: Closing the finished-highlight viewer lands somewhere useful

**Status:** TODO
**Impact:** 6
**Complexity:** 3
**Tier:** S
**Created:** 2026-10-08
**Updated:** 2026-10-08
**Epic:** [Epic 1: Bugs](EPIC.md) | **Milestone:** [Staging QA Walkthrough](../README.md)
**Source:** [walkthrough findings](../../../ux/2026-10-08-staging-qa-walkthrough/findings.md) (screenshots next to it)

**Decision gate:** Q14 (see [decision register](../README.md#decision-register)). RULED 2026-10-08: the recommended option was approved (exceptions: Q15 = C, Q16 = A); the text below states the ruled option.

## Problem

DraftReelPreview.jsx:173-182 handleClose reads the Annotate breadcrumb (peekAnnotateOrigin) and sends the user to Annotate. Added on purpose in ae11fd75c (2026-10-01, 'Return to Annotate after publishing...'), so this is a reversal of a recent decision, not a regression. After Finish then X, the walkthrough user landed in the game with the guide 'Open the highlight to watch or share it' pointing at a slot below the fold (qa-33).

## Solution

Per decision Q14: recommended is X closes to Home on the Finished tab with the new highlight listed (open the preview with the Home path set to the Finished tab via TAB_PATHS in utils/finishedReelNav.js, clear the breadcrumb on close); keep the 'Back to game plays' link. Alternative: keep returning to the game but scroll the highlight slot into view and use the banner 'Highlight finished. See it in Finished.'

## Context

### Relevant Files (REQUIRED)

- `src/frontend/src/components/DraftReelPreview.jsx`
- `src/frontend/src/utils/finishedReelNav.js`
- `src/frontend/src/components/ProjectManager.jsx (landingTabFromPath)`
- `src/frontend/src/components/DraftReelPreview.test.jsx`
- `src/frontend/src/screens/__tests__/overlayPublishExit.test.jsx`
- `src/frontend/src/screens/__tests__/focusPublishExit.test.jsx`

### Related Tasks

- Decision Q14.

### Test first (red before green)

DraftReelPreview test with the Annotate breadcrumb set: click X, expect editorMode PROJECT_MANAGER and path /home/published (today ANNOTATE).

## Implementation

### Steps

1. [ ] Load the knowledge docs named in the epic; verify the Problem against current code (docs are claims, code is truth)
2. [ ] Write the failing test above and observe it fail for the intended reason
3. [ ] Implement the Solution (surgical diff, no reactive persistence, no silent fallbacks)
4. [ ] Run the named relevant tests plus explicit lint; one fresh-context Reviewer on the diff
5. [ ] Commit with subject starting `T11990:` and the co-author line

### Progress Log

**2026-10-08**: Filed from the staging walkthrough (see findings). Root causes verified against master c6e6708fa by Opus expert agents.

## Acceptance Criteria

- [ ] After Finish then X the user is on Home with the Finished tab active and the new highlight listed
- [ ] 'Back to game plays' still goes to Annotate
- [ ] The ae11fd75c tests are rewritten deliberately, not deleted
- [ ] Relevant tests pass and lint is clean
