# T13040: Add footage tile in Annotate does nothing when clicked

**Status:** STAGING
**Impact:** 6
**Complexity:** 2
**Tier:** S (frontend; verify first)
**Created:** 2026-10-18
**Updated:** 2026-10-18
**Milestone:** Release check bugs (bugs first), see PLAN.md

## Source

Found by the T12590 staging re-walk, 2026-10-18 ([RESULTS.md section 10](../ux/2026-10-11-guide-coverage-sweep/RESULTS.md)). Screenshots are local only, under `docs/plans/ux/2026-10-11-guide-coverage-sweep/screens/` on the host that ran the walk.

## Problem

In Annotate (game 2 on staging), the "Add footage / Add another video to this game" tile is visible, but two bounded click attempts opened nothing. A visible tile that does nothing is a dead tap. It may be a scripted-click artifact (for example a file chooser that opened without a visible dialog), so verify with a real click first.

## Solution

Reproduce with a real pointer click in a headed browser and with a tap on a touch device. If nothing opens, fix the handler so the tile opens the add-footage flow (file picker or modal); if a file chooser does open, record that and close as not a bug.

## Context

### Relevant Files
- `src/frontend/src/` Annotate add-footage tile and its handler
- `.claude/knowledge/annotate.md`

### Related Tasks
- Found by T12590 (2026-10-18 re-walk)

## Acceptance Criteria

- [ ] A real click and a tap on the tile open the add-footage flow
- [ ] An e2e test clicks the tile and asserts the file chooser event or modal
