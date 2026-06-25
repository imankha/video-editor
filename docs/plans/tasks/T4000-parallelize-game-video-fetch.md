# T4000: Parallelize Game Video Fetch With /load (Cut Chained Round-Trip)

**Status:** TODO
**Impact:** 6
**Complexity:** 4
**Created:** 2026-06-25
**Updated:** 2026-06-25

## Problem

Opening a saved game in Annotate is two **sequential** round-trips, not one:

1. `GET /api/games/{id}/load` returns metadata + the presigned `playback_url` (~420ms).
2. **Only then** the `<video>` element starts fetching the video bytes from R2 (~316ms).

Evidence (prod HAR `app.reelballers.com.har`, captured 2026-06-25T19:45:26Z, game 7):

```
t=4    GET /api/games/7/load   ████████████ 421ms  -> returns playback_url
                                            (chained)
t=446  R2 video blob 1.24MB              ██████ 316ms   (starts the instant /load returns)
```

Total meaningful wall-clock ~762ms. The video fetch can't begin until `/load` hands back
the presigned URL, so the two costs **add** instead of **overlapping**.

### What this is NOT (already investigated — do not re-chase)

- **NOT slow backend code.** `/api/health` (trivial, skips the heavy db_sync middleware)
  took the *same* 378ms server-wait as `/load` in the HAR. Both requests arrived 1ms apart
  and stalled identically -> a transient **shared-vCPU contention spike**, not endpoint work.
- **NOT a Fly cold start / machine wake.** The single `reel-ballers-api` machine (lax,
  `cpu_kind=shared`, 1 vCPU, `min_machines_running=1`) was `started` continuously for ~17.5
  min before the capture; no suspend/resume in its event log. Live `/api/health` timings from
  the same client now are 70-210ms, not 378ms.
- **NOT geographic RTT** as the dominant cost (live timings confirm normal is sub-200ms).

So the only **durable, code-level** win that helps *every* load (and absorbs spikes better)
is removing the chained dependency: start the video fetch in parallel with `/load`.

## Solution

The video URL does **not** need to come from `/load`. The client knows `gameId` at click
time, and two stable, gameId-only endpoints already exist:

- `GET /api/games/{id}/stream` ([games.py:2235](../../../src/backend/app/routers/games.py#L2235)) —
  **bounded streaming proxy**: serves only moov + annotated clip-region byte windows from R2
  via httpx `StreamingResponse`. Already used as the fallback in `applyGameData`. Self-sufficient
  (queries clips itself). **Caveat:** routes the bytes *through* the Fly box — the same
  shared-vCPU that spikes — and incurs R2->Fly->client egress.
- `GET /api/games/{id}/video` ([games.py:1452](../../../src/backend/app/routers/games.py#L1452)) —
  **302 redirect** to a presigned R2 URL. Cheap hop, then bytes flow **direct from R2** (bypasses
  the Fly box). Serves the *full* video (no bounded windows).

Today `applyGameData` sets the `<video>` src from `/load`'s `playback_url`, falling back to
`/stream` only when `playback_url` is absent
([AnnotateContainer.jsx:514-537](../../../src/frontend/src/containers/AnnotateContainer.jsx#L514-L537)).

**Goal:** set the video src from a stable gameId-only URL **immediately** when the user opens
the game, so the video fetch runs **concurrently** with `/load`'s metadata fetch. Expected
~762ms -> ~450ms on the common case, and better spike tolerance.

### Design gate (architecture approval required — DECIDE BEFORE CODING)

This is design-gated. The implementing worker must STOP at the architecture gate and get the
chosen approach approved. Open questions for the design doc:

1. **Which stable URL to start with — `/stream` (proxy) or `/video` (302 -> direct R2)?**
   Trade-off: `/stream` keeps the bounded-window bandwidth savings but pushes 1.24MB through
   the contended shared-vCPU box (could stall worse during the exact spikes we're trying to
   beat). `/video` keeps bytes off the Fly box (direct R2) but loses bounded windows
   (over-fetches large games). Quantify: how big are typical games, and does the moov+clips
   window meaningfully shrink the transfer vs full video?
2. **Do NOT switch src mid-load.** Changing `annotateVideoUrl` after the fetch has begun
   restarts the download. So the URL chosen at click time is the one used — `/load`'s presigned
   `playback_url` then becomes metadata/expiry-refresh only (`schedulePlaybackUrlRefresh`),
   not the initial src. Confirm the refresh path still works without the presigned URL gating
   the first paint.
3. **Where to set src.** Ideally the moment the game is opened (gameId known), not inside
   `applyGameData` (which runs after `await loadGame`). Find the earliest click handler with
   gameId and set `annotateVideoUrl` there, with `/load` continuing in parallel. Watch the
   multi-video path (`isMultiVideo`) and the `#t=` resume-position suffix — the resume time
   currently comes from `/load` (`last_playhead_position` / `viewed_duration`), so seeking to
   the resume point may still depend on `/load`. Decide: start at t=0 and seek when `/load`
   lands, or accept first-paint at t=0.
4. **Gesture-based, no reactive persistence.** This is a read/load path. Setting the src is part
   of the open-game gesture — must not introduce any `useEffect`-driven write-back.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/containers/AnnotateContainer.jsx` — `handleLoadGame` (L576), `applyGameData`
  (L466), video-src wiring (L514-537), `setAnnotateVideoUrl`.
- `src/frontend/src/stores/gamesDataStore.js` — `loadGame` (L230), in-flight dedup.
- `src/backend/app/routers/games.py` — `load_game` (L2111), `stream_game_bounded` (L2235),
  `get_game_video` (L1452).
- `src/frontend/src/screens/AnnotateScreen.jsx` — where `handleLoadGame`/`loadGame` are invoked
  (find the open-game click path; L46-48, L199-201).

### Related Tasks
- Context only: HAR diagnosis in this conversation (no prior task).

### Technical Notes
- Backend likely needs little/no change (both endpoints exist). The work is mostly frontend:
  reorder so the video src is set from a stable URL before/parallel to `/load`.
- If `/stream` is chosen and proves to stall under contention, `/video` (302->R2) is the
  fallback design — keep both on the table until measured.
- Watch the `pendingClipSeekTime` and resume-position `#t=` logic — don't regress
  seek-to-clip or resume-where-you-left-off.

## Implementation

### Steps
1. [ ] Branch `feature/T4000-parallelize-game-video-fetch`.
2. [ ] Code Expert: trace the open-game click -> `handleLoadGame` -> `applyGameData` -> video
   src path; confirm earliest point gameId is known.
3. [ ] Architecture (GATE): write `docs/plans/tasks/T4000-design.md`; answer the 4 open
   questions; pick `/stream` vs `/video`; STOP for approval.
4. [ ] Test First: failing test asserting the video fetch starts without awaiting `/load`
   (e.g. src set from stable URL before `loadGame` resolves).
5. [ ] Implement the approved approach.
6. [ ] Frontend unit tests + relevant E2E (annotate open-game, resume position, seek-to-clip,
   multi-video).
7. [ ] Manual test steps + re-capture a HAR to confirm overlap.

### Progress Log

**2026-06-25**: Created from prod HAR diagnosis. Root cause = chained two round-trips
(`/load` then video). Backend not slow; not a Fly wake (both ruled out with live timing +
machine event log). Stable gameId-only endpoints `/stream` and `/video` already exist.

## Acceptance Criteria

- [ ] Video fetch begins concurrently with `/load` (verified in a fresh HAR: video request
      start no longer gated by `/load` completion).
- [ ] No regression in resume-position, seek-to-clip (`#t=`), or multi-video playback.
- [ ] No reactive persistence introduced (gesture-based only).
- [ ] Frontend tests pass.
