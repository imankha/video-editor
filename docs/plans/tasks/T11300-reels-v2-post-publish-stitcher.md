# T11300: Reels v2 - stitch published highlights into a college highlight reel

**Status:** ICE (not in the next version, user 2026-09-24)
**Impact:** 8
**Complexity:** 8
**Created:** 2026-09-24
**Updated:** 2026-09-24

## Problem

Parents want one assembled college / recruiting reel. The old Reels feature assembled RAW clips
into a multi-clip EDITABLE project, which forced Framing and Spotlight to handle multiple clips.
It is being removed (epic [single-clip-editor](single-clip-editor/EPIC.md)).

## Solution (vision, user's words 2026-09-24)

"Reels" comes AFTER Published: a place to stitch PUBLISHED clips together, control transitions,
add interstitial text frames, and make a college highlight reel. Framing and Spotlight stay
single-clip forever.

## Context

Reuse, don't rebuild (audit 2026-09-24): collections already provide ordered play-as-one
(`CollectionPlayer` / `IntroStoryPlayer` composite scrubber), stitched download (T4945 Modal
`stitch_members`, `ffmpeg_concat.py`, T4947 cache), intro cards + branded outro
(`serve_time_video.compose_serve_time_dispatched`), collection share links and Glicko rank
ordering. Transitions and interstitial text frames would extend `card_compose_plan` / compose.
Note: Modal never rendered dissolve/fade in the old pipeline; real transitions are new work.

Needs a design gate (Architect + ui-designer) when thawed.

## Salvaged notes from single-clip-editor removal

- **`GameClipSelectorModal.jsx` clip-assembly picker (deleted by T11230, 2026-09-27).** This was
  the "Create reel" UI: pick a subset of RAW clips and POST them to `/api/projects/from-clips` as
  one editable multi-clip project. T11300 needs a *similar* picker but over PUBLISHED highlights,
  so read the deleted file at its last commit before this task's branch for the interaction design.
  What it did / worth re-reading:
  - **Filter stack (all client-side for instant preview, mirrored server-side):** game multi-select
    with per-game clip counts, min-rating buckets (All / 3+ / 4+ / 5-only), tag multi-select with
    per-tag counts, and a "My athlete only" toggle. Counts recomputed per filter change from the
    full `GET /api/clips/raw` set.
  - **Per-clip manual exclusion** (`excludedClipIds` Set) layered on top of the filters, so the user
    could deselect individual clips the filters had included.
  - **Live totals card:** selected `clip_count` + summed `total_duration`, formatted with the
    hours case (`formatDuration` -> `utils/timeFormat`, `1:03:20` not `63:20`). This is the
    "live duration/cost total" the epic named as the reusable bit.
  - **Inline single-clip preview player** (play/pause a raw clip inside the modal without leaving).
  - **Suggested project name** derived from the selected games (`suggestedName` memo), de-duplicated
    against existing project names via `utils/uniqueName.ensureUniqueName` — has its own unit test
    (`GameClipSelectorModal.suggestedName.test.jsx`) worth resurrecting.
  - **Submit contract:** disabled at zero clips; posts EITHER explicit `clip_ids` (order-preserving)
    OR the filter params (`game_ids`/`min_rating`/`tags`) + `aspect_ratio` + `name`.
  - **Gotcha for a reimplementation:** the filter logic existed TWICE — once client-side here and
    once server-side in `projects.py::_build_clips_filter_query` (also deleted). They had to agree
    exactly or the preview count lied about what got created. `my_athlete === null` (pre-migration)
    was treated as `true` on BOTH sides. A v2 picker should keep ONE source of truth for the filter
    (server computes the set; client shows the same count) rather than reproducing this dual impl.

## Acceptance Criteria

- [ ] To be written at design time
