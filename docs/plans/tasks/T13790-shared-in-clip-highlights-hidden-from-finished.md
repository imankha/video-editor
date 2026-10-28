# T13790: A highlight finished from a shared-in clip is hidden from Finished, the count, collections and the Just-finished card

**Status:** WIP
**Impact:** 9
**Complexity:** 4
**Tier:** M (backend read filter at 8 call sites + test flips + doc updates; no schema change)
**Created:** 2026-10-27
**Updated:** 2026-10-27
**Milestone:** Release check bugs (bugs first), see PLAN.md

## Source

Staging QA, 2026-10-27 (hello@reelballers.com, profile 452b3380). The account received game "Vs Carlsbad QA" and its 4 clips through a share from imankh+stg-qa-20261025@gmail.com, so each clip has `raw_clips.shared_by` set and `my_athlete = 0` (materialization always imports on the Team layer and the UI locks that layer). The user ran Make highlight -> Frame -> Spotlight -> Finish on clip 2 "QA first play" (credits spent). The DB shows `final_videos` id 2 `published_at = 2026-10-28 01:52:17`, project 2 archived. Yet Home showed Finished badge 0, "View your completed work.", no Just-finished card; the Annotate screen for that play said "Finished / View Highlight"; and the Finished tile menu > Open as Draft opened the only tile present (Play 1, highlight id 1), which the user read as "it opened a different clip".

This is the same P1 shape as T10070 (sarkarati, 2026-09-14, credits spent, highlight unreachable). T10070 narrowed the predicate from "any Team-layer clip" to "shared-in clip" and kept this case.

## Root cause (expert-verified 2026-10-27)

`exclude_shared_in_reels_clause()` (`src/backend/app/queries.py:152-186`) drops every `final_videos` row whose source clip has `my_athlete = 0 AND shared_by IS NOT NULL`. It is applied at 8 read sites:

1. `routers/bootstrap.py:149` (downloads count; import :18)
2. `routers/collections.py:419` (collections summary)
3. `routers/collections.py:697` (`evaluate_collection_members`; import :38)
4. `routers/downloads.py:342` (`list_downloads`)
5. `routers/downloads.py:2592` (`GET /count`; import :32)
6. `routers/games.py:1572` (`_compute_reel_counts`; import :1561)
7. `routers/games.py:2125` (`get_brilliant_clips`; import :2111)
8. `routers/rank.py:124` (import :29)

What it was for: the June 2026 bug-22 fix (`accd56fc6`) blocked the **sweep** of that era, which auto-published raw stream-copies (`auto_*` filenames, `published_at = CURRENT_TIMESTAMP`) of every 5-star clip in any layer with no user action, so a teammate-rated shared-in clip could land in the recipient's Rankings and Collections by itself.

Why it is now pure harm: every live writer was checked. The sweep no longer publishes (T4175; `auto_export.py:490-521` "NO publish"). Export-complete inserts rows unpublished. The publish route (`downloads.py:2490/2498`) is the only code that sets `published_at`, and only on the user's explicit Finish. Moves null `source_clip_id`. Materialization copies games, clips and auto drafts only, never `final_videos`. Collection shares read the sharer's DB read-only. So the only thing that can create a published highlight from a shared-in clip today is the recipient's own paid Finish, which is exactly what the clause hides. Materialization even auto-creates a draft for every shared-in 5-star clip (`materialization.py:961-967`): the product invites the user to finish it, then hides the result.

The Annotate "Finished" label reads `EXISTS(final_videos WHERE project_id = p.id AND published_at IS NOT NULL)` (`clips.py:1328`) with no clause, which is why the two screens disagree. There is no second desync in this case.

## Solution

Delete `exclude_shared_in_reels_clause` from `queries.py` and remove it (and its import) at all 8 call sites. In `rank.py` keep `exclude_team_highlights_from_rank_clause()` (T11160, owner decision 2026-09-24: Team highlights are visible everywhere except Rankings). Shared-in clips are Team layer and cannot be moved to My Athlete, so they correctly stay out of Rankings through that clause; the test plan must not expect them there.

Rejected alternatives: narrowing to `auto_*`/sweep-made rows guards a state no current code creates (CLAUDE.md: no defensive fixes for internal bugs) and would treat sweep leftovers differently by provenance although own-clip `auto_*` leftovers are already visible; keeping it only for shared-collection resolution has no privacy basis (own Team-layer highlights already flow into shared collections).

Update the comments that describe the clause: `bootstrap.py:138-141`, the `_compute_reel_counts` docstring (`games.py` ~1449), the v031 migration docstring paragraph (lines 28-36, text only; v031 never calls the clause), and `.claude/knowledge/annotate.md:2494` (which still names the pre-T10070 `exclude_teammate_reels_clause`).

**No migration.** Rows that start showing are (a) highlights users finished from shared-in clips, the bug's victims, which will appear as unwatched (publish set `watched_at = NULL`) and bump the badge; (b) any pre-T4175 sweep `auto_*` rows from shared-in clips that v021 failed to delete (its R2-copy failure path `continue`s and leaves the row published, `v021:112-117`). (b) is the same kind of row as own-clip `auto_*` leftovers, already visible since T10070. A read-only cross-profile count of `published_at IS NOT NULL AND filename LIKE 'auto\_%' ESCAPE '\'` is good housekeeping for v021's gap; not a blocker, file separately if it finds anything.

Out of scope, note only: Annotate checks any version while the Gallery checks only the latest version. A re-export that keeps the prior row because a share still serves it (`publish_final_video.py:309`) leaves an older published row plus a newer unpublished one, so Annotate says Finished while Finished hides it until the user publishes again. Different mechanism; file if observed.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/queries.py` - delete `exclude_shared_in_reels_clause`
- `src/backend/app/routers/bootstrap.py`, `collections.py`, `downloads.py`, `games.py`, `rank.py` - remove the 8 uses + imports; comment updates
- `src/backend/app/migrations/profile_db/v031_reclassify_teammate_clips_to_team.py` - docstring text only
- `.claude/knowledge/annotate.md:2494` - fix the stale clause reference
- Tests: `src/backend/tests/test_reel_ranking.py::TestMyAthleteReelExclusion`, `src/backend/tests/test_game_reel_count.py`, new `src/backend/tests/test_t13790_shared_in_highlight_visible.py` (model on `test_t4050_publish_restore_roundtrip.py`)

### Related Tasks
- T10070 (narrowed the predicate; this removes it), T11160 (Team highlights visible everywhere except ranking), T4175 (sweep stopped publishing), T5330 (shared_by provenance)
- T13800 (independent: Open as Draft does not refresh the badge)

### Technical Notes
- Red-to-green proof is the existing tests that encode the bug flipping: they fail on current master and pass after the deletion.
- Staging confirmation of the row (already observed from the R2 copy, re-run before landing): `SELECT fv.id, fv.version, fv.published_at, rc.my_athlete, rc.shared_by FROM final_videos fv JOIN raw_clips rc ON rc.id = fv.source_clip_id WHERE fv.project_id = 2` on profile 452b3380 -> one row, published, `my_athlete = 0`, `shared_by` set.
- After deploy, affected users will see paid highlights appear as unwatched; a post-deploy note to them is approval-gated (user decides).

## Implementation

### Steps
1. [ ] Flip the tests that encode the bug (fail on current master): `test_reel_ranking.py::TestMyAthleteReelExclusion` -> `test_downloads_excludes_shared_in_reel` asserts `shared_in` present; `test_summary_excludes_shared_in_reel` `reel_count == 4`; `test_collection_members_exclude_shared_in_reel` members contain `shared_in`; `test_brilliant_clips_exclude_shared_in_reel` results contain `shared_in` (rename each to `..._includes_...`). `test_game_reel_count.py::test_shared_in_teammate_single_clip_reel_excluded` expects `{1: 1}`.
2. [ ] New test through the real publish path: seed game + raw clip (`my_athlete = 0, shared_by = 'sharer@x'`), auto project with that clip, unpublished `final_videos` row (project_id, source_clip_id, clip_count 1, aspect '9:16', game_ids [game]); `POST /api/downloads/publish/{pid}`; assert `GET /api/downloads/count` == 1, `GET /api/downloads` contains the id, bootstrap downloads count == 1, collections summary `reel_count` 1 for the game, `evaluate_collection_members(all, 9:16)` contains the id, `_compute_reel_counts` == {game: 1}, and `_rankable_pool` does NOT contain the id. `test_rankable_pool_excludes_all_team_layer_reels` stays unchanged.
3. [ ] Delete the clause + 8 uses + imports; update the four comment/doc sites
4. [ ] Curated tests (the three test files above + `test_collections_summary.py`, `test_t4050_publish_restore_roundtrip.py`) + import check + lint; review on the diff

### Progress Log

**2026-10-27**: Filed from staging QA with DB evidence; expert agent verified the writers audit and recommended deletion (no migration).

## Acceptance Criteria

- [ ] A highlight finished from a shared-in Team clip appears in Finished (tile, badge count, Just-finished card, per-game count) immediately after Finish
- [ ] The Annotate "Finished / View Highlight" label and the Finished tab agree for that play
- [ ] It still does not enter Rankings (Team-layer rule, T11160)
- [ ] Flipped tests fail before, pass after; new publish-path test passes
- [ ] On staging profile 452b3380, highlight id 2 shows in Finished without any data edit
