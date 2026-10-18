# T12910: Unrated marked plays are dropped from Watch plays and from the expiry recap

**Status:** TODO
**Impact:** 6
**Complexity:** 3
**Tier:** M (backend, ~3 files)
**Created:** 2026-10-18
**Updated:** 2026-10-18
**Milestone:** Release check bugs (bugs first). Blocks the [Keep Only Marked Plays epic](keep-only-marked-plays/EPIC.md).

## Problem

`auto_export.py::_get_annotated_clips` (line ~211) selects `WHERE rc.game_id = ? AND rc.rating IS NOT NULL`.
Two user-facing surfaces go through it:

1. **Watch plays on a live game.** `games.py::_compute_game_clips` (~1857) orders "via `_get_annotated_clips`",
   so `GET /api/games/{id}/recap-data` with `video_kind='game'` lists only rated plays. An unrated play
   the parent marked is simply missing from the list.
2. **The expiry recap.** At expiry the sweep stitches `recaps/{game_id}.mp4` from the same list. Per-play
   extracts are 5-star only (4-star fallback). After reclaim an unrated play has no recap entry and no
   extract: it is **unrecoverable**, while the Annotate clip list still shows it.

Unrated plays exist: Mark play persists the play with `rating NULL` immediately (T10690, nullable rating),
and the T11120 "Rate this play" gate fires only on editor exit. Closing the tab or app mid-edit, a crash,
or any play created between the T10690 deploy and the T11120 deploy (prod 2026-09-28) leaves NULL.
`auto_export_game` also reports `skipped` ("zero rated clips") for a game whose only plays are unrated,
so such a game reclaims with nothing preserved.

**Conflict with a recorded decision:** T10690's design table (`docs/plans/tasks/T10690-design.md` rows for
`auto_export.py:241` and `:164-166`) explicitly chose "No change" for the rated-only filter (2026-09).
That was reasonable when the recap was a nice-to-have. The Keep Only Marked Plays epic promises that
every MARKED play survives, so the filter is now a data-loss bug for the recap and Watch plays. The
5-star extract selection stays rating-driven (unchanged). Surfaced per the "external review can
override recent decisions" rule; **user ruling 2026-10-18: override accepted**, fix it.

## Solution

- `_get_annotated_clips`: drop the `rating IS NOT NULL` clause (rename to `_get_marked_clips` if the
  name would otherwise lie). Callers that need rated-only (`five_star or four_star` selection) filter
  in Python, which they already do.
- Recap mapping entries carry `rating: null` for unrated plays; the frontend recap sidebar already
  renders unrated through the T10690-safe primitives (`RatingIcon` / `getRatingAdjective`), verify.
- `auto_export_game`'s `skipped` verdict means "zero marked plays", not "zero rated plays".
- `recap_artifacts_present` (T10121 D1): "every layer with >=1 rated clip" becomes ">=1 marked play".
- Known gap, documented not fixed: games already at `auto_export_status='complete'` whose recap omitted
  unrated plays. If their source is still in R2 (in grace or extended) `backfill_hiq_recaps`'s regenerate
  path could rebuild them; past grace the footage is legitimately gone. Report the count from a dry-run
  script in the Progress Log; do not auto-regenerate in this task.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/services/auto_export.py` - `_get_annotated_clips`, `auto_export_game` skip verdict, `recap_artifacts_present`
- `src/backend/app/routers/games.py` - `_compute_game_clips` (live Watch plays listing)
- `src/backend/tests/test_auto_export*.py`, `src/backend/tests/test_t10121_*.py` - existing sweep/recap tests to extend
- `src/frontend/src/components/recap/RecapClipsSidebar.jsx` - verify unrated rendering (read-only check)

### Related Tasks
- Blocks: T12920 (epic task 1)
- Related: T10690 (nullable rating), T11120 (rating gate), T10121 (reclaim artifact gate), T4140 (recap as re-edit source)

### Technical Notes
- `.claude/knowledge/export-pipeline.md` Sweep row and T4175/T4140 entries describe the preservation path.
- Red-to-green proof: a game with one rated and one unrated play; before the fix the recap mapping has
  1 entry and `recap-data` (`video_kind='game'`) lists 1; after, both list 2. Second proof: a game with
  only unrated plays must not reach `skipped`.

## Implementation

### Steps
1. [ ] Failing tests: recap mapping + recap-data include the unrated play; unrated-only game is exported, not skipped
2. [ ] Remove the rating filter, adjust the skip verdict and the artifact gate
3. [ ] Dry-run count of already-complete games with unrated plays (script under `scripts/`, read-only)
4. [ ] Update `export-pipeline.md` (Sweep row: "every marked play", not "rated clips")

### Progress Log

**2026-10-18**: Filed while scoping the Keep Only Marked Plays epic.

## Acceptance Criteria

- [ ] `GET /api/games/{id}/recap-data` on a live game lists unrated plays
- [ ] The expiry recap and its `_clips.json` contain every marked play of the layer
- [ ] A game whose plays are all unrated is exported (`complete`), never `skipped`
- [ ] 5-star extract selection unchanged (test pins it)
- [ ] Curated backend tests pass; CI green
