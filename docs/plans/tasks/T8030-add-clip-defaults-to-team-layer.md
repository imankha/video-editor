# T8030: "Add Clip" sometimes defaults to Team layer instead of My Athlete

**Status:** STAGING
**Impact:** 4
**Complexity:** 2
**Created:** 2026-08-29 (reported live-testing staging)
**Updated:** 2026-08-29

## Problem

User report while testing staging: "When I click Add Clip, it seems to default to My
Team instead of My Athlete."

## Investigation (2026-08-29)

Traced the new-clip layer default end to end:
- `AnnotateFullscreenOverlay.jsx` seeds its `myAthlete` field from the
  `newClipLayerIsMine` prop on create (not edit).
- `newClipLayerIsMine` lives in `useAnnotateState.js` (default `true`).
- It is reset on every game-open gesture in `AnnotateContainer.handleLoadGame`
  (`src/frontend/src/containers/AnnotateContainer.jsx:747`) via
  `resolveInheritedNewClipLayer(gameData.annotations)`
  (`src/frontend/src/modes/annotate/hooks/useAnnotate.js:273-289`).
- That resolver returns **My Athlete for an empty game**, otherwise **inherits the layer
  of the game's most-recently-created OWN clip** (imported/shared clips are ignored as a
  signal). This is T6400's deliberate design (see
  `.claude/knowledge/annotate.md` § "New-clip layer is INHERITED, not toggled") — it
  REPLACED an earlier explicit "New clips go to: [Athlete/Team]" toggle that was removed
  for costing sidebar space.
- Thereafter, `newClipLayerIsMine` is updated imperatively by layer-assignment gestures:
  creating a clip (`AnnotateContainer.jsx:877`) or switching an existing clip's layer
  (`AnnotateContainer.jsx:928-933`).

Verified against real local data (`user_data/.../profiles/9fa7378c/profile.sqlite`,
`raw_clips` table): games with a mix of `my_athlete` 0/1 rows exist, confirming the
inheritance path is live and exercised, not dead code.

**Conclusion so far: the code is doing exactly what T6400 designed it to do.** If the
user's most recently created OWN clip in a game was tagged Team (e.g. because of a
teammate tag, or a deliberate Team clip), the NEXT "Add Clip" for that game correctly
inherits Team per the epic's stated intent.

## Open question for the user

Is this report:
- (a) Working as designed, but the design itself should change (e.g., new clips should
  always default to My Athlete regardless of the previous clip's layer, and Team should
  require an explicit per-clip switch every time)? This would partially reverse T6400's
  epic decision 2.
- (b) A genuine bug distinct from the inheritance mechanism above — if so, need the
  specific game/clip sequence that triggered it (which clip was created immediately
  before the one that showed the wrong default) to keep root-causing.

## Context

### Relevant Files
- `src/frontend/src/containers/AnnotateContainer.jsx` (seed + update call sites)
- `src/frontend/src/modes/annotate/hooks/useAnnotate.js` (`resolveInheritedNewClipLayer`)
- `src/frontend/src/modes/annotate/hooks/useAnnotateState.js` (`newClipLayerIsMine` state)
- `src/frontend/src/modes/annotate/components/AnnotateFullscreenOverlay.jsx` (consumes the prop)

### Related
- `.claude/knowledge/annotate.md` § T6400 (design rationale + resolution order)

## Progress Log

**2026-08-29**: User picked the recommended option: new clips always default to My
Athlete, regardless of the previous clip's layer (full reversion of T6400's
inherit-last-layer default, not just the game-open seed). Implemented:
`resolveInheritedNewClipLayer` deleted from `useAnnotate.js` (+ its test file);
`AnnotateContainer` now resets `newClipLayerIsMine` to `true` unconditionally on
every game-open gesture and no longer updates it from create/switch-layer
gestures; stale T6400 comments and the annotate.md knowledge doc updated in the
same commit. Per-clip Team switching is unchanged. 65 targeted unit tests green
(layer/teammate/filter tests across ClipDetailsEditor, AnnotateFullscreenOverlay,
ClipsSidePanel, useAnnotateState), `npm run build` clean. Branch pushed, PR #310
opened against master. **Not manually verified in a browser this session** — see
T8040's progress log for the same environment caveat. Recommend a quick click-
through (create a Team clip, click Add Clip again, confirm it offers My Athlete)
before merging.

**2026-08-30**: Fixed the local dev-login hangs (see T8040's progress log — an
orphaned/stuck uvicorn process pair on port 8000, unrelated to this change).
Live-verified as imankh@gmail.com on "New Game": created a clip, switched it to
Team, saved (Clip 2, Team layer, confirmed in the sidebar); clicked Add Clip
again — the new form defaulted to "My Athlete layer" (checked), not Team,
confirming the fix. Cleaned up the test Team clip afterward. Merged to master
via PR #310 (squash, CI green).

## Acceptance Criteria

- [x] A new clip's default layer is always My Athlete, regardless of the
  previous clip's layer in that game.
- [x] Switching a clip to Team is still a one-click per-clip action (unchanged).
- [x] Targeted frontend unit tests pass.
