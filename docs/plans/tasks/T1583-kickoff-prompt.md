# T1583 Kickoff Prompt: Auto-Export Pipeline (Recap + Brilliant Clips)

Implement T1583: Auto-Export Pipeline

Read CLAUDE.md for project rules, workflow stages, coding standards, and agent orchestration before starting.

Read the task file: `docs/plans/tasks/T1583-auto-export-pipeline.md`
Read the approved design doc: `docs/plans/tasks/T1583-design.md`

## Epic Context

This is the final task in the Storage Credits epic. Prior tasks already shipped:
- **T1580** (Game Storage Credits): Added `storage_expires_at` to games table, `game_storage_refs` table in auth.sqlite, `get_expired_hashes()` and `delete_refs_for_hash()` in auth_db.py. The cleanup sweep functions EXIST but are NOT YET CALLED -- there is no scheduled task or endpoint that triggers them.
- **T1581** (Storage Extension UX): ExpirationBadge, StorageExtensionModal, extension endpoint.
- **T1582** (Upload Surcharge): Added `AUTO_EXPORT_SURCHARGE = 1` to `storage_credits.py`, `calculate_upload_cost()` includes it. The surcharge is already being charged on uploads.

**Key insight:** Users are already paying the 1-credit auto-export surcharge on every upload. This task delivers the service that surcharge pays for.

## Design is APPROVED -- Skip to Classification + Implementation

The design doc at `docs/plans/tasks/T1583-design.md` has been approved. Do NOT re-run the Code Expert or Architect stages. Start with classification, then proceed directly to implementation.

## Design Decisions (Already Approved)

1. **FFmpeg-only for brilliant clips (no GPU upscale)** -- Auto-projects have no crop keyframes. Simple center-crop to 9:16 at 1080x1920 via FFmpeg. No Modal GPU needed.
2. **Asyncio background loop with "cron till next event"** -- NOT an admin endpoint. The sweep runs as an in-process asyncio task started on app startup. After each sweep, it queries `get_next_expiry()` to find the next game expiry and sleeps until then (capped at 24h).
3. **Failures never block R2 deletion** -- Export failures are logged and marked `failed`, but the sweep continues and deletes the R2 object.
4. **Multi-video games: both halves renew together** -- The sweep only processes a game when ALL of its blake3 hashes have expired. If half 1 expires but half 2 was extended, the game is not swept.

## Implementation Order (from design doc)

### Backend (do first):
1. **Database migration** (`database.py`): Add `auto_export_status` and `recap_video_url` columns to games table. Follow the existing T1580 `storage_expires_at` PRAGMA + ALTER TABLE pattern.
2. **R2 global delete** (`storage.py`): Add `delete_from_r2_global()` function for deleting game videos (which are stored without user prefix).
3. **Auth DB functions** (`auth_db.py`): Add `get_users_for_hash()` and `get_next_expiry()`.
4. **Auto-export service** (`services/auto_export.py` -- NEW): Core service with `auto_export_game()`, `_export_brilliant_clip()`, `_generate_recap()`.
5. **Sweep scheduler** (`services/sweep_scheduler.py` -- NEW): Asyncio background loop with `run_sweep_loop()`, `do_sweep()`, `start_sweep_loop()`, `stop_sweep_loop()`.
6. **Main.py integration**: Start/stop sweep loop in startup/shutdown events.
7. **Games API** (`routers/games.py`): Add `auto_export_status` and `recap_video_url` to games list response. Add `GET /{game_id}/recap-url` endpoint.

### Frontend (do after backend):
8. **GameCard** (`ProjectManager.jsx`): If expired AND has recap_video_url, click opens recap player instead of extension modal.
9. **RecapPlayerModal** (`RecapPlayerModal.jsx` -- NEW): HTML5 video player modal with "Extend Storage" button.

## Critical Gotchas

### Background tasks need explicit R2 sync
Request middleware auto-syncs DB to R2, but background tasks (no HTTP context) must call `sync_db_to_r2_explicit()` manually. See the pattern in `src/backend/app/services/export_worker.py` line ~113 (`_sync_after_export`). The auto-export service MUST sync explicitly after every DB write.

### ContextVars must be set for per-user operations
The sweep processes games across multiple users. Before accessing a user's DB, set ContextVars:
```python
set_current_user_id(user_id)
set_current_profile_id(profile_id)
ensure_database()  # Downloads profile.sqlite from R2 if not cached locally
```

### `auto_project_id` may be NULL for 5-star clips
Not all 5-star clips have auto-projects. The auto-export handles this by using FFmpeg center-crop regardless -- it does NOT use the existing export pipeline.

### Multi-video games have separate hashes per sequence
`game_videos` table has per-sequence blake3_hash. Clips reference the correct video via `raw_clips.video_sequence` matching `game_videos.sequence`. Use `COALESCE(gv.blake3_hash, g.blake3_hash)` to resolve the source video hash.

### Timestamps are ISO strings, not Unix
`storage_expires_at` is stored as ISO string. Compare with `datetime.utcnow().isoformat()`.

### `final_videos.published_at` controls My Reels visibility
Set `published_at = CURRENT_TIMESTAMP` when inserting auto-exported final videos so they appear in My Reels.

### FFmpeg is available on the backend server
`video_probe.py` already uses FFmpeg. No need for Modal GPU for recap or brilliant clip export.

### Game videos are stored globally in R2
R2 key for game videos is `{env}/games/{blake3_hash}.mp4` (no user prefix). Use the global R2 functions, not user-scoped ones, for downloading and deleting game videos.

## Prior Task Learnings

- **T1582**: The surcharge is a flat 1 credit added to `calculate_upload_cost()`. Extension costs do NOT include the surcharge.
- **T1580**: The `storage_expires_at` column was added via ALTER TABLE migration in `database.py` line ~1037. Follow the same pattern.
- **T1580**: Game videos are deduped by blake3_hash. Multiple users can reference the same physical R2 object. The `game_storage_refs` table tracks per-user references.
- **T1581 TDZ crash**: `useCallback` hooks that reference `useMemo` values must be declared AFTER the memo. Be careful with hook ordering.
