# T12810: The sport picked in the Upload game dialog is not there when the first play is tagged

**Status:** TODO
**Impact:** 6
**Complexity:** 2
**Tier:** M (frontend, 1-2 files, async ordering)
**Created:** 2026-10-16
**Milestone:** Deploy Candidate (P1). BLOCKS the deploy: staging-only regression in new code (T12160).

## Problem

External QA B01 ([report](../../ux/2026-10-16-external-qa/QA-REPORT.md), screenshot
`screenshots/B01_mark-play_1440x900_sport-not-carried.png`). Brand-new account: in the Upload game
dialog the parent picks Soccer, then picks the video and uploads. Marking the first play and opening
"Add Tags and Notes" shows "Pick your sport to tag this play" instead of soccer tags; they must pick
Soccer a second time. Every new user who uses the dialog's sport picker hits this on their first play.

Not on prod: the dialog picker arrived with T12160 (a25132291, 2026-10-08), after the prod tag.

## Mechanism (verified in code, root cause not yet observed)

- `GameDetailsModal.jsx:56` holds `pickedSport` locally. `submitGame` (`:163`) calls
  `await onCreateGame(...)` FIRST, which is `ProjectsScreen.handleAnnotateWithFile`
  (`ProjectsScreen.jsx:340`): it sets `pendingGameData` and switches to Annotate.
- Only afterwards (`:191-197`) does it `updateProfile(id, { sport })`, with errors swallowed to
  `console.error`.
- The tag panel reads `currentProfile?.sport || NO_SPORT` (`ClipDetailsEditor.jsx:98`, `:276`).
- `updateProfile` (`profileStore.js:139`) patches optimistically, then PUT + `fetchProfiles({force:true})`.
  Likely: Annotate mounts and a forced profile fetch returns the stale `no_sport` while the PUT is in
  flight, overwriting the optimistic patch. Alternatives: the PUT fails silently on a brand-new account.
  Confirm with the network log first (PUT `/api/profiles/{id}` and any "Failed to save sport" console line).

## Solution

Write the sport as part of the Upload gesture BEFORE handing off to Annotate: await `updateProfile`
before `onCreateGame`, and fail loudly (toast, keep the modal open) if it fails instead of logging.
Make sure no in-flight profile refetch can land a stale sport over it.

## Acceptance Criteria

- [ ] Red-first test: new profile with `no_sport`, pick Soccer in the dialog, upload; when Annotate mounts the profile sport is `soccer` and the tag panel shows soccer tags (fails on current master)
- [ ] A failed sport save is visible to the user, never only a console line
- [ ] Live check on a fresh account: first play shows soccer tags with no second pick
