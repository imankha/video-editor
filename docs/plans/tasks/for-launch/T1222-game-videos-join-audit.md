# T1222: Audit game_videos JOIN Pattern Across Backend

**Status:** TESTING
**Impact:** 5
**Complexity:** 3
**Created:** 2026-04-14

## Context

During T1220 debugging we discovered that for **multi-video games**, `games.blake3_hash` and `games.video_filename` are always `NULL` by design. The real per-video hashes live in `game_videos.blake3_hash` keyed by `(game_id, sequence)`, and clips reference a specific source video via `raw_clips.video_sequence`. Single-video games populate the legacy `games` columns and work incidentally.

T1220 patched `src/backend/app/routers/export/framing.py` to JOIN `game_videos` + guard against NULL hashes. The other readers below may have the same latent bug.

## Suspected readers (from investigation)

- [src/backend/app/routers/storage.py:253,305,343](src/backend/app/routers/storage.py) — reads `games.blake3_hash` / `games.video_filename`, often filtered with `IS NOT NULL`. Effect: multi-video games silently drop out of listings/sync instead of erroring.
- `src/backend/app/routers/games_upload.py` — same pattern per prior grep.
- Any other exporter (`multi_clip.py`, `overlay.py`, etc.) that builds an `input_key` from `games.blake3_hash` for a clip that goes through framing before it.

Grep broadly for `games.blake3_hash` and `g.blake3_hash` to find all sites.

## Acceptance

- Every reader that resolves a game's source video hash joins `game_videos ON (game_id, sequence=rc.video_sequence)` instead of (or in addition to) `games`.
- Any site that constructs a key like `f"games/{hash}.mp4"` raises loudly when the hash is falsy (per CLAUDE.md "no silent fallbacks for internal data").
- Manual test: create a multi-video game, verify listings / sync / all export paths work.
- Import check passes; existing tests pass.

## Out of scope

- Dropping the vestigial `games.blake3_hash` / `games.video_filename` columns — separate cleanup task once no readers remain.
- Schema tightening (FK from `raw_clips.video_sequence` to `game_videos(game_id, sequence)`, NOT NULL on `video_sequence`) — also separate.

## Notes

The framing fix in T1220's branch is the reference implementation: one SQL change + two guards. Follow the same shape.
