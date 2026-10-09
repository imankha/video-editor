# T12290: Guide in the finished viewer and share; closing the guide never fails silently

**Status:** WIP
**Impact:** 5
**Complexity:** 2
**Tier:** S
**Created:** 2026-10-08
**Updated:** 2026-10-08
**Epic:** [Epic 4: Guide correction](EPIC.md) | **Milestone:** [Staging QA Walkthrough](../README.md)
**Source:** [walkthrough findings](../../../ux/2026-10-08-staging-qa-walkthrough/findings.md) (screenshots next to it)

## Problem

DraftReelPreview (finished viewer) and the share modal have no coach (qa-32, qa-35). InstructionCoach's X uses void setCoachEnabled(false) (InstructionCoach.jsx:31); on failure saveSettings reverts and only logs to the console, so the bubble silently reappears (the toggle itself shows an error, GuidanceToggle.jsx:20). coachEnabled = true destructuring defaults are repeated in 8 places over data that already defaults in DEFAULT_SETTINGS (settingsStore.js:45-47).

## Solution

Add rules: finished.viewer 'Done! Tap Share to send it, or Download to save it.' (anchor the share control); finished.viewer.shared deliberately null; share 'Choose who can watch, then tap Share.'. Await setCoachEnabled in the X handler and surface failure the way the toggle does. Remove the 8 duplicated defaults.

## Context

### Relevant Files (REQUIRED)

- `src/frontend/src/components/DraftReelPreview.jsx`
- `src/frontend/src/components/ShareModal.jsx`
- `src/frontend/src/components/instructions/InstructionCoach.jsx`
- `src/frontend/src/stores/settingsStore.js`
- `src/frontend/src/components/instructions/resolveGuide.js`

### Related Tasks

- T12230.

### Test first (red before green)

Test: setCoachEnabled rejects, expect a visible error (fails today, silent).

## Implementation

### Steps

1. [ ] Load the knowledge docs named in the epic; verify the Problem against current code (docs are claims, code is truth)
2. [ ] Write the failing test above and observe it fail for the intended reason
3. [ ] Implement the Solution (surgical diff, no reactive persistence, no silent fallbacks)
4. [ ] Run the named relevant tests plus explicit lint; one fresh-context Reviewer on the diff
5. [ ] Commit with subject starting `T12290:` and the co-author line

### Progress Log

**2026-10-08**: Filed from the staging walkthrough (see findings). Root causes verified against master c6e6708fa by Opus expert agents.

## Acceptance Criteria

- [ ] Enumeration covers finished.viewer and share
- [ ] A failed X save shows an error, not a silent re-show (test)
- [ ] Relevant tests pass and lint is clean
