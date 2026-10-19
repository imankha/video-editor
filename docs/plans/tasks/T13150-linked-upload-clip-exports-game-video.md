# T13150: A linked upload clip exports the game video instead of its own file

**Status:** TODO
**Impact:** 6
**Complexity:** 3
**Tier:** M (backend, ~3 files: export source queries + clip playback URL; repro first)
**Created:** 2026-10-18
**Updated:** 2026-10-18
**Milestone:** Release check bugs (bugs first). Blocks the "link to game" option of [T13230](veo-import/T13230-add-clip-veo-zip-pick-list.md) (Veo Highlights Import epic).

## Problem

Found statically on 2026-10-18 while designing the [Veo Highlights Import epic](veo-import/EPIC.md);
**not yet reproduced live. Reproduce before fixing.**

T10300 (prod 2026-09-21) lets a directly uploaded clip (`raw_clips.source='upload'`, own file at
`raw_clips/{blake3}.mp4`, range `0..duration`) be linked to a game. Linking only sets
`raw_clips.game_id`; `video_sequence` stays NULL.

The export queries then pick the game's video for that clip:

- `routers/export/framing.py` ~253-268 and `routers/export/multi_clip.py` ~2284 select
  `COALESCE(gv.blake3_hash, g.blake3_hash) AS game_blake3_hash` with
  `LEFT JOIN game_videos gv ON rc.game_id = gv.game_id AND rc.video_sequence = gv.sequence`.
  `video_sequence` is NULL, so `gv` is NULL and the game's own hash wins (`games.blake3_hash` is set
  for single-video games, `games.py` ~579).
- `services/export_helpers.py::resolve_clip_source` step 1 sees `game_id` + `game_blake3_hash`,
  HEAD-probes `games/{hash}.mp4`, and returns `(game_url, raw_start_time=0, raw_end_time=duration)`.

**Expected failure:** a 20 s uploaded clip linked to a game renders the first 20 s of the GAME
(kickoff), not the clip. Same suspect shape in `clips.py::get_clip_playback_url` (~2766, joins
`gv.sequence = COALESCE(rc.video_sequence, 1)`) and in `poster.py` (~1391, via `resolve_clip_source`).
No export path checks `rc.source`.

## Solution (direction; confirm with the repro)

The clip's source is decided by `raw_clips.source`, not by whether `game_id` is set (`game_id` NULL
stopped meaning "upload" when T10300 shipped; annotate.md T10300 notes). Make every
`game_blake3_hash` selection yield NULL for `rc.source = 'upload'` (one shared SQL fragment, or
gate step 1 of `resolve_clip_source` on `source == 'game'`, carrying `source` into the clip dict),
so upload clips always resolve to step 2 (their own file). Grep every `COALESCE(gv.blake3_hash`
and every `resolve_clip_source` caller (`src/`, `e2e/`, `scripts/`); fix all, not just framing.

## Acceptance

1. Red first: a backend test links an upload clip to a single-video game and asserts the framing
   export's resolved source is `raw_clips/{filename}` over `0..duration`. It fails on master
   because it resolves to `games/{hash}.mp4`.
2. Same assertion for multi-clip export, poster, and the playback URL the frontend uses for a
   linked upload clip.
3. A game clip (`source='game'`) still resolves to the game video (regression guard).
4. Live: on dev, upload a clip, link it, frame and export; the output shows the clip's footage.

## Knowledge docs
`.claude/knowledge/export-pipeline.md`, `.claude/knowledge/backend-services.md` (Pre-cut clip upload T8370), `.claude/knowledge/annotate.md` (T10300).
