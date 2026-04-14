# T1180: Fix Root Cause of NULL `games.video_filename`

**Status:** TODO
**Impact:** 4
**Complexity:** 3
**Created:** 2026-04-13

## Problem

`games` rows are being committed with `video_filename IS NULL` (and sometimes
`blake3_hash IS NULL`), leaving the games table referencing nothing on disk.
Downstream code formats the column into URLs and produces paths like
`games/None.mp4`, which ffprobe/ffmpeg can't resolve. Framing export crashes
on such projects with an opaque ffmpeg error.

Per CLAUDE.md "No defensive fixes for internal bugs": **fix the write path
that allows NULL to be committed**, not the read paths that choke on it.

## Observed symptom (surfacing incident)

Dev, imankh@gmail.com, project 3. Framing export failed:

```
ffmpeg_service - ERROR - Failed to get video info for
  https://<r2>.cloudflarestorage.com/reel-ballers-users/games/None.mp4
  Command '['ffprobe', ...]' returned non-zero exit status 1.
app.routers.export.framing - ERROR - [Render Background] Failed:
  Failed to extract clip range from R2: ffmpeg error
```

Data chain:

| Table | Row | Bad field |
|-------|-----|-----------|
| `working_clips` id=3 | `uploaded_filename = NULL` | no upload fallback |
| `raw_clips` id=5 | `filename = ''` | empty |
| `games` id=4 | `video_filename = NULL`, `blake3_hash = NULL` | **root** |

Game: `"Vs Albion Fram Nov 11"`, user `34e63f91-1969-44ec-a1ce-19f8f8226382`,
profile `cc51236f`.

## Investigation targets

1. Every `INSERT INTO games` / game-row-creating code path — enumerate and
   check whether `video_filename` is written in the same transaction.
2. Whether there's a legitimate two-step flow (insert row → upload video →
   UPDATE video_filename) that fails-open on upload error, leaving a
   half-committed row.
3. Whether the schema should have `video_filename NOT NULL` (check if any
   legitimate workflow requires a row to exist before the video is known —
   e.g., auto-created games from annotations).
4. Whether an older migration or test helper is seeding NULL rows.

## Fix preference order

1. **Atomic write**: don't commit the row until video_filename is known.
2. **Transactional cleanup**: if step 2 must remain separate, rollback the
   row on upload failure.
3. **Schema constraint**: add `NOT NULL` if no legitimate null case exists.

## Cleanup of existing broken row

One-off deletion (or manual via admin) for game id=4 in imankh's dev DB,
after user confirmation. **Do not** add startup-time repair code — log
loudly if the state is observed after the fix ships, but don't silently
"heal" it (per coding standard).

## Out of scope

- Pre-flight export validation / user-visible 400 on export-time NULL.
  That's a downstream read-side concern; if the write path is fixed, the
  read-side never sees it. File a follow-up only if an unfixable two-step
  flow forces us to accept transient NULL state.

## Context

### Relevant Files

- `src/backend/app/database.py` — `games` schema (line ~623).
- Grep entry points: `INSERT INTO games`, `video_filename =`, game upload
  routers, game auto-create paths (`auto_project_id` flow).
- `src/backend/app/services/ffmpeg_service.py:get_video_info` — where the
  symptom surfaces (do not modify as part of this task).

### Related Tasks

- T1160 + T1170: DB hygiene (discovered this during manual testing).
- T1440: Trace multi-video games — similar class of "game lookup returns
  null" bug.

## Acceptance Criteria

- [ ] Root-cause write path identified and documented in the design doc.
- [ ] Fix prevents `games.video_filename` from being committed as NULL in
  all identified paths.
- [ ] Regression test: the creation path that produced the bug is
  exercised and now either succeeds with a value or rolls back cleanly.
- [ ] Existing broken row in dev DB cleaned up (after user confirms).
- [ ] No defensive guards added to export/read paths.
