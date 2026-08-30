# T8030: "Add Clip" sometimes defaults to Team layer instead of My Athlete

**Status:** WAITING ON USER
**Impact:** 4
**Complexity:** 2
**Created:** 2026-08-29 (reported live-testing staging)

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
