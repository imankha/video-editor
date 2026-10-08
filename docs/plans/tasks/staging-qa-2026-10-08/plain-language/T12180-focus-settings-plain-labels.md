# T12180: Focus settings in plain labels

**Status:** TODO
**Impact:** 4
**Complexity:** 2
**Tier:** M
**Created:** 2026-10-08
**Updated:** 2026-10-08
**Epic:** [Epic 2: Confusing moments and jargon](EPIC.md) | **Milestone:** [Staging QA Walkthrough](../README.md)
**Source:** [walkthrough findings](../../../ux/2026-10-08-staging-qa-walkthrough/findings.md) (screenshots next to it)

**Decision gate:** Q15 (see [decision register](../README.md#decision-register)). RULED 2026-10-08: the recommended option was approved (exceptions: Q15 = C, Q16 = A); the text below states the ruled option.

## Problem

FocusSettingsPanel.jsx:72-118 shows 'Advanced editing', 'This highlight', 'View only', 'Straighten' and 'Background / Dim' (qa-15); most strings are inline (only EDITOR_PANELS.ADVANCED_EDITING is in displayNames.js:829). Dim darkens the area outside the crop box (CropOverlay.jsx:664,677).

## Solution

Remove the 'Advanced editing', 'This highlight' and 'View only' headings; one collapsed disclosure 'More options' (ChevronDown, memory-only useState) containing 'Fix a tilted camera' (value: 'Drag along a straight line on the field to level it.', Off/On kept) and 'Darken outside the box' (value: 'Editing view only. Your highlight is not changed.'). Strings move to EDITOR_PANELS. (Q15 ruled 2026-10-08: the draggable rectangle is called 'box'.)

## Context

### Relevant Files (REQUIRED)

- `src/frontend/src/components/settings/FocusSettingsPanel.jsx`
- `src/frontend/src/config/displayNames.js`

### Related Tasks

- After T12110. Decision Q15 for the word.

### Test first (red before green)

Unit: panel renders 'More options' collapsed and none of the old headings (fails today).

## Implementation

### Steps

1. [ ] Load the knowledge docs named in the epic; verify the Problem against current code (docs are claims, code is truth)
2. [ ] Write the failing test above and observe it fail for the intended reason
3. [ ] Implement the Solution (surgical diff, no reactive persistence, no silent fallbacks)
4. [ ] Run the named relevant tests plus explicit lint; one fresh-context Reviewer on the diff
5. [ ] Commit with subject starting `T12180:` and the co-author line

### Progress Log

**2026-10-08**: Filed from the staging walkthrough (see findings). Root causes verified against master c6e6708fa by Opus expert agents.

## Acceptance Criteria

- [ ] One 'More options' disclosure collapsed by default
- [ ] No 'Advanced editing / This highlight / View only' text
- [ ] Relevant tests pass and lint is clean
