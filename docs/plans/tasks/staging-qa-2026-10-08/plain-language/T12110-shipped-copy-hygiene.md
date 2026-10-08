# T12110: Shipped-copy hygiene: em dashes, '--', 'Saved'

**Status:** TODO
**Impact:** 3
**Complexity:** 1
**Tier:** S
**Created:** 2026-10-08
**Updated:** 2026-10-08
**Epic:** [Epic 2: Confusing moments and jargon](EPIC.md) | **Milestone:** [Staging QA Walkthrough](../README.md)
**Source:** [walkthrough findings](../../../ux/2026-10-08-staging-qa-walkthrough/findings.md) (screenshots next to it)

## Problem

Rule violations in user-visible strings. Em dashes: NoSportTagWarning.jsx:46, ProfileSportButton.jsx:78, displayNames.js:79 (GHOST_GAME_SAVE_MESSAGE), LayerSegmentedControl.jsx:44,60 (aria-label). '--' used as a dash: displayNames.js:476 ('Effects are free -- no credits needed'), :690 FOCUS_ADD_SPOTLIGHT_TOAST, :798 SELECT_PLAYER_OPTIONAL. 'Saved' UI copy: displayNames.js:728 toast title 'Spotlight saved', :431 UPLOAD_STATE.LOCAL_PREVIEW_NOTICE 'not saved online yet'.

## Solution

Rewrite each string without dashes and without 'Saved' (persistence stays silent). Add a grep test that fails on an em dash, ' -- ' or the word Saved in user-visible string literals under src/frontend/src.

## Context

### Relevant Files (REQUIRED)

- `src/frontend/src/config/displayNames.js`
- `src/frontend/src/components/NoSportTagWarning.jsx`
- `src/frontend/src/components/ProfileSportButton.jsx`
- `src/frontend/src/components/LayerSegmentedControl.jsx`

### Related Tasks

- None. Do first in this epic (touches displayNames.js).

### Test first (red before green)

The grep test, which fails today on the listed lines.

## Implementation

### Steps

1. [ ] Load the knowledge docs named in the epic; verify the Problem against current code (docs are claims, code is truth)
2. [ ] Write the failing test above and observe it fail for the intended reason
3. [ ] Implement the Solution (surgical diff, no reactive persistence, no silent fallbacks)
4. [ ] Run the named relevant tests plus explicit lint; one fresh-context Reviewer on the diff
5. [ ] Commit with subject starting `T12110:` and the co-author line

### Progress Log

**2026-10-08**: Filed from the staging walkthrough (see findings). Root causes verified against master c6e6708fa by Opus expert agents.

## Acceptance Criteria

- [ ] No em dash or ' -- ' in user-visible strings under src/ (grep test)
- [ ] No 'Saved' toast title or notice
- [ ] Relevant tests pass and lint is clean
