# T12860: Clip card title click does not open the highlight; make the whole card open it

**Status:** TODO
**Impact:** 4
**Complexity:** 2
**Tier:** S/M (frontend, 1 file once reproduced)
**Created:** 2026-10-16
**Milestone:** Next build (external QA 2026-10-16). Present on prod, so it does not block the deploy.

## Problem

External QA C06 ([report](../../ux/2026-10-16-external-qa/QA-REPORT.md), screenshots
`screenshots/baseline_clips_1440x900.png`, `baseline_finished_1440x900.png`). On Clips, clicking the
card title did not open the highlight; only the thumbnail did. The tester also found the lifecycle
hard to follow: a generated highlight sits in Clips as "In progress" and reaches Finished only after
another Finish step.

## Current code (not yet reproduced)

`DraftTile.jsx:565` root div has `onClick={handleCardClick}`; the title `<h3>` (`:731`) has no handler
and should bubble. Candidate causes: `handleCardClick` returns early (`canOpen` false, or
`isCoarsePointer && actionsRevealed`), or the z-10 scrim covers the title. Same structure on prod
(`:726`, `:842`). Status words were already unified by T11790 (STAGING).

## Solution

Reproduce at 1440x900 with a mouse on a post-generation card, find which branch eats the click, fix
it so any click on the card body (title included) opens it. Naming of the Clips/Finished lifecycle is
out of scope here; note any concrete wording proposal for the T9730 sign-off instead.

## Acceptance Criteria

- [ ] Red-first test: clicking the title of an openable card opens it (fails on master if the repro holds)
- [ ] Live check on desktop and phone: title, thumbnail and empty card area all open the highlight; rename pencil still renames
