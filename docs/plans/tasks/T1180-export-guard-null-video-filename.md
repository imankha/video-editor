# T1180: Guard Export Against Games with NULL video_filename

**Status:** TODO
**Impact:** 4
**Complexity:** 2
**Created:** 2026-04-13

## Problem

Framing export crashes with an opaque ffmpeg error when the source game has `games.video_filename IS NULL`. The source URL is built via string-format and becomes literally `games/None.mp4`, which ffprobe fails to resolve.

**Observed traceback (dev, imankh@gmail.com, project 3):**

```
app.services.ffmpeg_service - ERROR - Failed to get video info for
  https://<r2>.cloudflarestorage.com/reel-ballers-users/games/None.mp4
  Command '['ffprobe', ...]' returned non-zero exit status 1.
app.routers.export.framing - ERROR - [Render Background] Failed:
  Failed to extract clip range from R2: ffmpeg error
```

Data chain when it happens:

| Table | Row | Bad field |
|-------|-----|-----------|
| `working_clips` id=3 | `uploaded_filename = NULL` | no direct-upload fallback |
| `raw_clips` id=5 | `filename = ''` (empty) | — |
| `games` id=4 | `video_filename = NULL`, `blake3_hash = NULL` | **root cause** |

The game `"Vs Albion Fram Nov 11"` was created without a `video_filename` — likely a failed upload or an interrupted game-creation flow that committed the `games` row before the video was persisted.

## How it fails today

Export dispatches (202), the background task computes fps, starts the LocalProcessor with `Input: games/None.mp4`, and ffmpeg fails on the first probe. The user sees a generic export failure; credits are reserved and must be refunded manually (or via existing error-path refunds — verify).

## Solution

Two layers:

### 1. Export pre-flight validation (fail fast, user-visible)

Before returning 202 from `POST /api/export/render`, resolve the source URL for every clip and reject any whose resolved path ends with `None` (or has a NULL `video_filename`). Return 400 with a message like `"Clip 'X' references a game with no uploaded video — please re-upload the game."`

Avoids credit reservation and background task dispatch for unexportable projects.

### 2. Backfill/cleanup detection (optional, lower priority)

Admin endpoint or a `session_init` one-shot that logs (does not delete) any `games` rows with `video_filename IS NULL` that are referenced by any `raw_clips`. Makes the corrupted state visible without silently pruning (per project coding standard: log loudly, don't hide).

## Out of scope

- Fixing the upstream create-game flow that allows `video_filename = NULL` to be committed. That's a separate task once we know the source — could be a concurrent upload abort, a schema default, or an older code path. File follow-up if the pre-flight logs reveal the pattern.
- Deleting the corrupted game 4. User can do that manually via existing delete flows.

## Context

### Relevant Files

- `src/backend/app/routers/export/framing.py` — `_run_local_framing_export` around line 500 (where `input_path` is built).
- `src/backend/app/services/ffmpeg_service.py` — `get_video_info` raises the underlying error.
- `src/backend/app/routers/export/render.py` (or wherever `POST /api/export/render` lives) — add pre-flight check here.
- Game video URL resolution — grep for `games/{...}.mp4` or `video_filename` in export paths.

### Related Tasks

- T1160 + T1170: DB hygiene (discovered this bug during manual testing of those).
- T1440: Trace multi-video games — similar class of "game lookup returns null" bug.

## Acceptance Criteria

- [ ] `POST /api/export/render` returns 400 with a clear message when any clip's source game has `video_filename IS NULL`.
- [ ] No credits are reserved when pre-flight fails.
- [ ] Test: export with a project containing a clip whose game has `video_filename = NULL` → 400, no background task, no credit reservation.
- [ ] (Optional) Session-init logs count of orphaned `games` rows.
