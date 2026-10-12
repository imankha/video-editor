# T12410: Annotate capture-window hint ("6 seconds before, 2 after") (decision)

**Status:** WIP
**Impact:** 4
**Complexity:** 2
**Tier:** M
**Created:** 2026-10-10
**Updated:** 2026-10-11
**Found by:** [T12320](T12320-restore-frontend-unit-tests-green.md) item 3

## Problem

The capture-window hint is gone. `ANNOTATE.MARK_PLAY_HELPER` is dead code and the coach watch body is empty. `docs/designs/instruction-coach-system.md` says the hint should move to a supporting line or a Why? disclosure. The firstRunDisclosure test that guarded the numbers was rewritten.

## Solution

Ruling needed: **restore** as a supporting line or Why? disclosure (users learn what a mark captures, more copy) or **drop** (cleaner, but the capture window is hidden; delete the dead string and amend the design doc). Judged during [T12310](staging-qa-2026-10-08/T12310-re-run-staging-walkthrough.md): does a first-time user understand what a mark captures without it? Copy must not claim the app frames or tracks automatically.

## Ruling (2026-10-11, T12310 re-run, user agreed)

Restore, as one plain supporting line under the Mark play card text (not in the guide, so it works with Guidance off and on phones): "Saves the last 6 seconds and the next 2. You can change it." Evidence: [RESULTS.md](../ux/2026-10-08-staging-qa-walkthrough/re-run/RESULTS.md) section 6b (rr-05, rr-06, rr-101). Parents tap Mark play after the goal, so this is the number they need before the tap.

## Context

### Relevant Files (REQUIRED)

- `ANNOTATE.MARK_PLAY_HELPER` in the copy constants
- `docs/designs/instruction-coach-system.md`
- `src/frontend/src/modes/AnnotateModeView.firstRunDisclosure.test.jsx`

## Implementation

### Steps

1. [x] Ruling from T12310: restore as a supporting line on the Mark play card
2. [ ] Failing test first, then render the line (reuse or replace the dead `ANNOTATE.MARK_PLAY_HELPER`); amend the design doc if it differs
3. [ ] Commit with subject starting `T12410:`

## Acceptance Criteria

- [x] Ruling recorded in this file
- [ ] The Mark play card shows the line at 1440 and 390 with Guidance on and off
- [ ] No dead `MARK_PLAY_HELPER` string remains, and the design doc matches behavior

## Evidence screenshots

Kept in `staging-qa-2026-10-08/re-run/screens/T12410/` (delete that folder when this task is archived):

- [rr-05-annotate-ready-1440.jpg](staging-qa-2026-10-08/re-run/screens/T12410/rr-05-annotate-ready-1440.jpg)
- [rr-05-annotate-scrolled-to-cards-1440.jpg](staging-qa-2026-10-08/re-run/screens/T12410/rr-05-annotate-scrolled-to-cards-1440.jpg)
- [rr-06-annotate-play-editor-1440.jpg](staging-qa-2026-10-08/re-run/screens/T12410/rr-06-annotate-play-editor-1440.jpg)
- [rr-101-m390-first-play-editor-newgame.jpg](staging-qa-2026-10-08/re-run/screens/T12410/rr-101-m390-first-play-editor-newgame.jpg)
