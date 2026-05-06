# T2620: Import Backend Service

## Summary

Build the production import API: a unified `POST /api/games/import-url` endpoint that detects the platform (Veo or Trace), downloads the video server-to-server, uploads to R2, and creates the game record. Includes progress tracking for the frontend.

## Prerequisites

- T2600 (Veo POC) — TESTING or DONE
- T2610 (Trace POC) — TESTING or DONE

The POC service modules (`veo_import.py`, `trace_import.py`) become the foundation. This task promotes them to production quality and wraps them in an API.

## Implementation Plan

### API Endpoint

`POST /api/games/import-url`
```json
{
  "url": "https://app.veo.co/matches/...",
  "opponent_name": "Beach FC",
  "game_date": "2026-05-02",
  "game_type": "away"
}
```

Response:
```json
{
  "import_id": "uuid",
  "status": "resolving",
  "game_id": null
}
```

### Progress Endpoint

`GET /api/games/imports/{import_id}/progress`
```json
{
  "status": "downloading",
  "platform": "veo",
  "progress_pct": 42,
  "downloaded_bytes": 1340000000,
  "total_bytes": 3200000000,
  "estimated_seconds_remaining": 45,
  "error": null,
  "game_id": null
}
```

Statuses: `resolving` → `checking_credits` → `downloading` → `uploading` → `creating_game` → `complete` | `error`

### Flow

1. **Detect platform** from URL pattern (Veo vs Trace)
2. **Resolve video info** — reuse POC modules to get download URL(s) + total size
3. **Check credits** — calculate cost from file size, verify user has enough
4. **Deduct credits** — reserve before starting download
5. **Download + upload** — stream to R2 with progress tracking
   - Veo: single stream, direct MP4
   - Trace: ffmpeg remux per half, then upload
6. **Create game record** — same as regular upload flow (game + game_videos rows)
7. **Activate game** — mark as ready for annotation

### Background Processing

Import runs as a background task (not blocking the request). The endpoint returns immediately with an `import_id`. Frontend polls progress.

Use `asyncio.create_task` with error handling — same pattern as export pipeline.

### Trace Multi-Half Handling

Trace games have 2 halves → 2 separate video files. This maps naturally to the existing `per_half` video mode:
- Create game with `video_mode: per_half`
- Upload `gamevideo1.mp4` as half 1, `gamevideo2.mp4` as half 2
- Each gets its own `game_videos` row with blake3 hash

### Credit Calculation

Reuse existing size-based credit logic from game upload. HEAD/size-estimate before download so user sees cost before confirming.

### Error Handling

- URL doesn't match any known platform → `"Unsupported URL. Currently supports Veo and Trace links."`
- Private/deleted game → platform-specific message
- Insufficient credits → return cost + current balance, don't start download
- Download fails mid-stream → refund credits, clean up partial R2 upload
- ffmpeg fails (Trace) → clean up temp files, refund credits

### Concurrency

- Max 1 concurrent import per user (prevent abuse)
- Import lock in memory (or DB) — reject new import if one is running

## Files Affected
- `src/backend/app/routers/games.py` — new import endpoint
- `src/backend/app/services/veo_import.py` — promote from POC
- `src/backend/app/services/trace_import.py` — promote from POC
- `src/backend/app/services/game_import.py` (new) — unified orchestrator
- `src/backend/tests/test_game_import.py` (new) — API-level tests

## Out of Scope
- Retry failed imports (user can re-paste the URL)
- Import history page
- Batch import (multiple games at once)
