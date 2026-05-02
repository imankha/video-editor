# T1583: Auto-Export Pipeline (Recap + Brilliant Clips)

**Status:** TODO
**Impact:** 8
**Complexity:** 6
**Created:** 2026-05-02
**Updated:** 2026-05-02
**Split from:** [T1582](storage-credits/T1582-game-recap-on-expiry.md) (pricing surcharge shipped separately)

## Problem

When a game video expires, the raw video is deleted from R2. Users lose the ability to watch their highlights. T1582 added a 1-credit surcharge on uploads to pre-fund GPU auto-export — this task delivers the service that surcharge pays for.

## Solution

Before a game video is deleted (during the daily cleanup sweep), auto-generate:

1. **Game Recap Video** — All annotated clips concatenated into a single 480p video (CPU-only FFmpeg, no GPU needed).
2. **Brilliant Clip Exports** — All 5-star clips individually exported through the framing + overlay pipeline and saved to My Reels.

Both artifacts are small (tens of MB), stored indefinitely as final/working videos (no expiry).

## Context

### Economic Analysis

See [T1582 economic analysis](storage-credits/T1582-game-recap-on-expiry.md#economic-analysis) for full GPU cost breakdown. Summary: typical game costs $0.0096 in GPU = 0.13 credits. The 1-credit surcharge (already shipping) provides 5-7x margin.

### Relevant Files

**Backend (export pipeline):**
- `src/backend/app/routers/export/framing.py` - Framing export (GPU upscale + crop)
- `src/backend/app/routers/export/multi_clip.py` - Multi-clip export pipeline
- `src/backend/app/services/export_helpers.py` - Export job creation helpers
- `src/backend/app/services/modal_client.py` - Modal GPU interface

**Backend (game management):**
- `src/backend/app/routers/games.py` - Game activation, list, delete
- `src/backend/app/services/auth_db.py` - game_storage_refs, expiry tracking
- `src/backend/app/database.py` - Schema (add recap_video_url column)

**Frontend:**
- `src/frontend/src/components/ProjectManager.jsx` - Game cards (expired game click → play recap)
- `src/frontend/src/stores/gamesDataStore.js` - Game data (add recap/brilliant fields)

### Related Tasks
- **T1582** (Upload Surcharge) - Pricing already shipped
- **T1580** (Game Storage Credits) - Provides the expiry infrastructure and daily sweep
- **T1116/T1117** (Export Pipeline) - Shared export pipeline used for auto-export

## Implementation

### Steps

1. [ ] Add `auto_export_status` and `recap_video_url` columns to games table
2. [ ] Create `auto_export_game()` service function:
   - Query all annotated clips for the game
   - Filter 5-star (or 4-star fallback) for brilliant export
   - Queue brilliant clips through framing + overlay pipeline
   - Concat all clips into recap video (CPU-only FFmpeg, 480p)
   - Upload recap to R2 as `recaps/{game_id}.mp4`
   - Store brilliant exports in My Reels (gallery)
   - Update game: `auto_export_status = 'complete'`, `recap_video_url`
3. [ ] Modify daily cleanup sweep to call `auto_export_game()` before R2 deletion
4. [ ] Frontend: expired game card click → play recap video (if available)
5. [ ] Frontend: show brilliant clips in My Reels with "Auto-exported" badge

## Acceptance Criteria

- [ ] All 5-star clips are auto-exported before game video deletion
- [ ] Recap video is generated from all annotated clips (CPU-only, 480p)
- [ ] Expired games with recap show playable video on click
- [ ] Brilliant clip exports appear in My Reels
- [ ] Auto-export is idempotent (doesn't re-run on already-exported games)
- [ ] GPU cost per game stays under 0.5 credits (typical scenario)
- [ ] Users with no annotated clips skip auto-export (no wasted GPU)
