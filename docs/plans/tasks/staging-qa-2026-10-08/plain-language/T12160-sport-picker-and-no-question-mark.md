# T12160: Sport: a labelled 'Pick sport' chip and a picker before tags

**Status:** WIP
**Impact:** 5
**Complexity:** 3
**Tier:** M
**Created:** 2026-10-08
**Updated:** 2026-10-08
**Epic:** [Epic 2: Confusing moments and jargon](EPIC.md) | **Milestone:** [Staging QA Walkthrough](../README.md)
**Source:** [walkthrough findings](../../../ux/2026-10-08-staging-qa-walkthrough/findings.md) (screenshots next to it)

**Decision gate:** Q9 (see [decision register](../README.md#decision-register)). RULED 2026-10-08: the recommended option was approved (exceptions: Q15 = C, Q16 = A); the text below states the ruled option.

## Problem

The header sport button shows the emoji ? (ProfileSportButton.jsx:83, tagRegistry.js:84) with no text and reads as Help (qa-04); tags need a sport, found only inside 'Add Tags and Notes' (NoSportTagWarning.jsx:44-48); the 'What sport is this?' overlay (AnnotateModeView.jsx:1219) is mobile-only.

## Solution

Header chip for NO_SPORT: Lucide Trophy 16 plus text 'Pick sport' in the same 38px pill, aria-label 'Pick your sport for play tags'; never the ? emoji anywhere. Helper text 'Pick your sport to see tags for it. You can keep editing this play.' Where the picker lives is decision Q9; recommended B: a 'Sport (for play tags)' row in the upload modal between the cost row and the drop zone, only while the profile sport is NO_SPORT, nothing preselected, written to the profile only on the Upload gesture (adds a line to the T11880 modal).

## Context

### Relevant Files (REQUIRED)

- `src/frontend/src/components/ProfileSportButton.jsx`
- `src/frontend/src/components/NoSportTagWarning.jsx`
- `src/frontend/src/components/GameDetailsModal.jsx`
- `src/frontend/src/modes/AnnotateModeView.jsx`

### Related Tasks

- Decision Q9. After T12110.

### Test first (red before green)

Unit: ProfileSportButton with NO_SPORT renders 'Pick sport' and no ? glyph (fails today).

## Implementation

### Steps

1. [ ] Load the knowledge docs named in the epic; verify the Problem against current code (docs are claims, code is truth)
2. [ ] Write the failing test above and observe it fail for the intended reason
3. [ ] Implement the Solution (surgical diff, no reactive persistence, no silent fallbacks)
4. [ ] Run the named relevant tests plus explicit lint; one fresh-context Reviewer on the diff
5. [ ] Commit with subject starting `T12160:` and the co-author line

### Progress Log

**2026-10-08**: Filed from the staging walkthrough (see findings). Root causes verified against master c6e6708fa by Opus expert agents.

## Acceptance Criteria

- [ ] No ? emoji anywhere
- [ ] NO_SPORT header reads 'Pick sport'
- [ ] Picker reachable before the tags section
- [ ] Relevant tests pass and lint is clean
