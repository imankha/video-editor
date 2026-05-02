# T1582: Auto-Recap & Brilliant Clip Export Before Expiry

**Status:** TODO
**Impact:** 8
**Complexity:** 6
**Created:** 2026-05-01
**Updated:** 2026-05-01
**Epic:** [Storage Credits](EPIC.md)

## Problem

When a game video expires (T1580), the raw video is deleted from R2. The user's annotations and clip metadata persist, but they can never watch their highlights again unless they re-upload the same game. This undermines the core value proposition: users annotated their best moments, but lose the ability to see them.

## Solution

Before the game video is deleted (during the daily cleanup sweep or at a configurable lead time before expiry), auto-generate two artifacts:

1. **Game Recap Video** -- A compilation of all annotated clips from the game, concatenated into a single playable video. When the user clicks an expired game, they see this recap instead of a "Game Expired" dead-end.

2. **Brilliant Clip Exports** -- All 5-star clips are individually exported through the standard framing + overlay pipeline and saved as standalone videos in My Reels. The user keeps their best moments forever.

Both artifacts are small (tens of MB) and fall under the "final/working video" category -- prepaid at upload time, no expiry, stored indefinitely for negligible R2 cost.

## Economic Analysis

### GPU Cost Per Game

The critical question: what does it cost us to auto-export clips for a typical game?

**Assumptions (typical game):**

| Parameter | Conservative | Typical | Generous |
|---|---|---|---|
| Annotated clips | 5 | 10 | 15 |
| Brilliant (5-star) clips | 2 | 4 | 8 |
| Average clip duration | 8s | 10s | 15s |
| Total brilliant video seconds | 16s | 40s | 120s |

**Modal GPU pricing:**

| GPU | Rate | Source |
|---|---|---|
| T4 | $0.000164/s | Modal pricing (experiments/e1_baseline.py) |
| CPU (2 cores) | $0.0000262/s | Modal pricing |

**Processing cost breakdown:**

| Component | Method | Time Estimate | Cost |
|---|---|---|---|
| Framing (crop + upscale) | T4 GPU, ~1x realtime | = video seconds | $0.000164/s |
| Overlay compositing | CPU, very fast | ~1-2s per clip | ~$0.00005 |
| Recap concat | CPU (FFmpeg) | ~2-5s total | ~$0.0001 |

**Per-game GPU cost (brilliant clips only):**

| Scenario | Brilliant Seconds | GPU Cost | In Credits (@ $0.072) |
|---|---|---|---|
| Conservative (2 clips × 8s) | 16s | $0.0026 | 0.04 |
| Typical (4 clips × 10s) | 40s | $0.0066 | 0.09 |
| Generous (8 clips × 15s) | 120s | $0.0197 | 0.27 |

**Per-game recap cost (CPU-only concat, no upscale):**

| Scenario | Total Seconds | CPU Cost | In Credits |
|---|---|---|---|
| Conservative (5 clips × 8s) | 40s | $0.001 | 0.01 |
| Typical (10 clips × 10s) | 100s | $0.003 | 0.04 |
| Generous (15 clips × 15s) | 225s | $0.006 | 0.08 |

### Break-Even Credit Surcharge

**Total auto-export cost per game (typical):** $0.0066 (GPU) + $0.003 (CPU) = **$0.0096**

**Credits needed to break even:** $0.0096 / $0.072 = **0.13 credits**

Even at the worst-case generous scenario: $0.0197 + $0.006 = $0.026 / $0.072 = **0.36 credits**

**Recommendation:** Add **1 credit** to the upload cost. This provides 5-7x margin over typical GPU costs, covering variance in clip count and duration. The upload cost for a 2.5 GB game goes from 1 to 2 credits.

### Revised Upload Pricing (with auto-export)

```
upload_cost = storage_cost + auto_export_surcharge

storage_cost = max(1, ceil(size_gb * 0.015 * (days/30) * 1.10 / 0.072))  # existing T1580
auto_export_surcharge = 1  # flat, covers GPU + CPU for brilliant clip export
```

| Game Size | Storage Cost | Auto-Export | Total Upload Cost |
|---|---|---|---|
| 1.0 GB | 1 credit | 1 credit | 2 credits |
| 2.5 GB | 1 credit | 1 credit | 2 credits |
| 5.0 GB | 2 credits | 1 credit | 3 credits |
| 10.0 GB | 3 credits | 1 credit | 4 credits |

### What 8 Starting Credits Buys (with auto-export)

At typical 2.5 GB game size (2 credits each with auto-export):

| Journey | Credits Used |
|---|---|
| 4 uploads (all with auto-export) | 8 |
| 3 uploads + 2 extensions | 8 |

Users get fewer uploads but each upload produces permanent brilliant clips. Net value is higher.

### R2 Storage Cost of Artifacts

| Artifact | Size | R2 Cost (5 years) | Strategy |
|---|---|---|---|
| Recap video (480p, ~15 MB) | ~15 MB | $0.014 | Prepaid in upload cost, no expiry |
| Each brilliant clip export (~10 MB) | ~10 MB | $0.009 | Prepaid in upload cost, no expiry |
| 4 brilliant clips | ~40 MB | $0.036 | Total storage negligible |

All artifacts combined cost ~$0.05 for 5 years of R2. Well under 1 credit.

## Context

### Relevant Files

**Backend (export pipeline):**
- `src/backend/app/routers/export/framing.py` - Framing export (GPU upscale + crop)
- `src/backend/app/routers/export/multi_clip.py` - Multi-clip export pipeline
- `src/backend/app/services/export_helpers.py` - Export job creation helpers
- `src/backend/app/services/modal_client.py` - Modal GPU interface
- `src/backend/app/services/storage_credits.py` - Credit cost calculation (add surcharge)

**Backend (game management):**
- `src/backend/app/routers/games.py` - Game activation, list, delete
- `src/backend/app/services/auth_db.py` - game_storage_refs, expiry tracking
- `src/backend/app/database.py` - Schema (add recap_video_url column)

**Frontend:**
- `src/frontend/src/components/ProjectManager.jsx` - Game cards (expired game click → play recap)
- `src/frontend/src/stores/gamesDataStore.js` - Game data (add recap/brilliant fields)

### Related Tasks
- **T1580** (Game Storage Credits) - Provides the expiry infrastructure and daily sweep
- **T1581** (Storage Extension UX) - Extension alternative to expiry
- **T530** (Credit System) - Credit infrastructure
- **T1116/T1117** (Export Pipeline) - Shared export pipeline used for auto-export

### Technical Notes

**Trigger:** The daily cleanup sweep (T1580 step 8) is the natural place. Before deleting the R2 game video object, check if auto-export has already run. If not, queue the auto-export job, and only delete the R2 object after the exports complete.

**Clip selection for brilliant export:** Query `raw_clips` for the game, filter by `rating >= 5`. If no 5-star clips exist, fall back to 4-star. If none, skip brilliant export (recap still generated from all clips).

**Recap video format:** 480p horizontal (no upscale needed), all clips concatenated with simple crossfade transitions. CPU-only -- no GPU required. Stored as `recaps/{game_id}.mp4`.

**Brilliant clip format:** Same as user-initiated export -- framing + overlay pipeline, stored in My Reels as normal export outputs.

**Idempotency:** Tag the game row with `auto_export_status` (pending/complete/failed). The sweep only attempts once per game; failures are logged but don't block video deletion (the user can still extend to keep the video).

## Implementation

### Steps

1. [ ] Add `auto_export_surcharge` constant (1 credit) to `storage_credits.py`
2. [ ] Update `calculate_upload_cost()` to include surcharge
3. [ ] Add `auto_export_status` and `recap_video_url` columns to games table
4. [ ] Create `auto_export_game()` service function:
   - Query all annotated clips for the game
   - Filter 5-star (or 4-star fallback) for brilliant export
   - Queue brilliant clips through framing + overlay pipeline (reuse export pipeline)
   - Concat all clips into recap video (CPU-only FFmpeg)
   - Upload recap to R2 as `recaps/{game_id}.mp4`
   - Store brilliant exports in My Reels (gallery)
   - Update game: `auto_export_status = 'complete'`, `recap_video_url`
5. [ ] Modify daily cleanup sweep to call `auto_export_game()` before R2 deletion
6. [ ] Frontend: expired game card click → play recap video (if available)
7. [ ] Frontend: show brilliant clips in My Reels with "Auto-exported" badge
8. [ ] Update upload cost display to reflect new total (storage + auto-export)

## Acceptance Criteria

- [ ] Upload cost includes 1-credit auto-export surcharge
- [ ] All 5-star clips are auto-exported before game video deletion
- [ ] Recap video is generated from all annotated clips (CPU-only, 480p)
- [ ] Expired games with recap show playable video on click
- [ ] Brilliant clip exports appear in My Reels
- [ ] Auto-export is idempotent (doesn't re-run on already-exported games)
- [ ] GPU cost per game stays under 0.5 credits (typical scenario)
- [ ] Users with no annotated clips skip auto-export (no wasted GPU)
