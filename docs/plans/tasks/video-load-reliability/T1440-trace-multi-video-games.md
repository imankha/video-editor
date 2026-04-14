# T1440: Trace (multi-video) Games Fail in Framing with "Video format not supported"

**Status:** TESTING
**Epic:** [Video Load Reliability](EPIC.md)
**Created:** 2026-04-13

## Problem

Trace game uploads produce **multi-video games** — the upload splits the recording into 2+ sequences (e.g. halves). Each sequence is stored in the `game_videos` table with its own `blake3_hash`. The legacy `games.blake3_hash` / `games.video_filename` columns are left NULL for these games.

Annotate worked because it plays from the local blob URL (pre-upload). Framing hit:

```
[VIDEO_LOAD] start id=1 url=/api/clips/projects/3/clips/3/file
[VIDEO] Error: Video format not supported (code 4)
[FaststartCheck] on-load verdict=ERROR error=HTTP 404
```

## Root cause

The working-clips list query in `clips.py` resolved the clip's source video only via `LEFT JOIN games g ON rc.game_id = g.id` and read `g.blake3_hash`. For multi-video games that's NULL, so `game_video_url` came back null in the response, `FramingScreen.getClipVideoConfig` fell through to the `/file` endpoint, and that 404'd (game-backed clips have no `raw_clips.filename`).

Veo flow works because Veo uploads create single-video games where `games.blake3_hash` IS populated.

## Fix

Add `LEFT JOIN game_videos gv ON gv.game_id = rc.game_id AND gv.sequence = COALESCE(rc.video_sequence, 1)` to two clip queries and prefer `gv.blake3_hash` when present:

1. `GET /api/clips/projects/{project_id}/clips` (list) — populates `game_video_url` on response.
2. `GET /api/clips/projects/{pid}/clips/{cid}/stream` (T1430 proxy) — would otherwise break for Trace clips even after fix #1 when they fall on the cold-path.

Also `COALESCE(gv.duration, g.video_duration)` + `COALESCE(gv.video_size, g.video_size)` on the stream endpoint so the byte-range math uses per-sequence metadata.

## Acceptance

- [ ] Reload framing on the Trace-uploaded project → video plays; no 404, no "format not supported".
- [ ] Veo-uploaded projects still work (regression check).

## Files

- `src/backend/app/routers/clips.py` (two query sites)

## Out of scope

- Warmup endpoint's multi-video game support (if tier-1 queue misses Trace clips, follow-up task).
- Why Trace uploads split into halves vs. Veo which doesn't — that's a product-design decision, orthogonal.
