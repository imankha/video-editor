# T13300: A linked upload clip still touches the game video on three secondary paths

**Status:** TODO
**Impact:** 3
**Complexity:** 3
**Tier:** M (backend, ~3 files; low urgency)
**Created:** 2026-10-21
**Updated:** 2026-10-21
**Milestone:** Live Queue (backlog)

## Source

Reviewer findings on PR #619 (T13150), 2026-10-21. T13150 fixed the main path (export resolver, playback URL, poster, framing and multi-clip queries now key on `raw_clips.source`, not `game_id`). These three paths still treat a linked upload clip (`source='upload'`, `game_id` set, `video_sequence` NULL) as a game clip. None is known to show wrong footage in normal use.

## Problem

1. **`source_confirmed_unavailable`** (`src/backend/app/services/export_helpers.py` ~L477-479) still HEAD-probes `games/{game_hash}.mp4` for an upload clip. If the clip's own file is gone but the game still exists, it returns False and the failure surfaces as a generic render error instead of the source-unavailable code.
2. **Working-clips list** (`src/backend/app/routers/clips.py` ~L2083-2135): `game_video_url` is still populated for linked upload clips. It feeds Focus preload hints (`FocusScreen.jsx` ~L584-595) and the metadata probe fallback (`useProjectLoader.js` ~L180). Real playback goes through the fixed playback-url endpoint, so the likely cost is a wasted preload or probe. Not traced end to end.
3. **`/stream` proxy** (`clips.py` ~L2941) still serves game bytes for a linked upload clip, and Focus falls back to `/stream` on any non-404 failure of playback-url (for example a 502), so game footage can still show in that failure case.

## Solution

Apply the same discriminator T13150 used (`source == 'upload'` skips the game step) to each path: gate the game probe in `source_confirmed_unavailable`, null `game_video_url` for upload clips in the list query, and make `/stream` serve the clip's own file for upload clips. Grep `src/`, `e2e/` and `scripts/` for every remaining `COALESCE(gv.blake3_hash` and `game_blake3_hash` consumer (including `auto_export` and `storage` queries, which the PR neither fixed nor tested) and decide each explicitly.

## Context

### Relevant Files
- `src/backend/app/services/export_helpers.py` (`source_confirmed_unavailable`)
- `src/backend/app/routers/clips.py` (working-clips list, `/stream`)
- `src/frontend/src/screens/FocusScreen.jsx`, `src/frontend/src/hooks/useProjectLoader.js` (consumers of `game_video_url`)
- `src/backend/tests/test_resolve_clip_source.py`, `src/backend/tests/test_t13150_caller_clips_carry_source.py`, `src/backend/tests/test_playback_url.py` (patterns)
- `.claude/knowledge/export-pipeline.md`, `.claude/knowledge/annotate.md` (T10300 notes)

### Related Tasks
- Follows: T13150 (PR #619). Blocks nothing; T13230's link option depends on T13150 only.

## Acceptance Criteria

- [ ] For a linked upload clip whose own file is missing, the export reports source-unavailable, not a generic render error (test)
- [ ] The working-clips list returns no game video URL for `source='upload'` clips, and Focus still loads them (test)
- [ ] `/stream` for a linked upload clip never serves game bytes (test)
- [ ] Remaining `game_blake3_hash` consumers are each listed as fixed or intentionally game-only
