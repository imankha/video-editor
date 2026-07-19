# T5530: Camera Time Alignment (audio auto-suggest + manual confirm)

**Status:** TODO
**Impact:** 7
**Complexity:** 6
**Created:** 2026-07-19
**Updated:** 2026-07-19

## Problem

The two cameras start recording at different moments (and may stop/restart at halftime
differently), so "the same game moment" has different timestamps in each camera. Without
alignment, the T5540 toggle would jump the viewer to a different point in the game. The
time model is settled in [EPIC.md](EPIC.md) decision 4: a shared wall-clock with a
`wall_offset` per `shared_game_videos` row (slot-0's first video = offset 0).

The physical setup is our ally: both cameras stand next to each other, so their audio
tracks are near-identical — audio cross-correlation should nail offsets to well under a
second, with a human confirm as the safety net.

## Solution

### A. Auto-suggestion (backend)

`POST /api/shared-games/{id}/align/suggest` (member-only, explicit "Sync cameras" gesture):

1. For each video pair to align (each slot-1 video against the overlapping slot-0
   candidates), extract mono audio **RMS envelopes at ~100 Hz** via ffmpeg from the R2
   sources (`-vn -ac 1 -ar 8000` → frame RMS; stream ranges, don't download whole files —
   a few minutes of audio around candidate overlaps is enough once a coarse pass on
   decimated envelopes localizes the offset).
2. Cross-correlate envelopes (`scipy.signal.correlate` on mean-subtracted, normalized
   envelopes); peak lag → offset; peak sharpness (peak / second-peak ratio) → confidence.
3. Respond `{suggestions: [{shared_game_video_id, wall_offset, confidence}]}`. Low
   confidence (< threshold, tune on validation set) → return the suggestion flagged
   `low_confidence: true`; missing/silent audio → suggestion omitted (frontend falls back
   to fully manual). **No silent fallback to 0** — an unknown offset stays NULL and the UI
   says so.

Validation protocol (before wiring UI): take 2-3 real game videos, split each into two
"cameras" by cutting the file at different points and re-muxing with known offsets, add
noise (volume drop, band-pass) → assert recovered offset within ±0.2 s. Commit this as a
unit test with small synthesized envelope fixtures (pure-python, no media in git).

### B. Confirm/nudge UI (frontend)

"Sync cameras" banner (game card + Annotate) when both slots have video and any
`wall_offset IS NULL` / unconfirmed. Flow: run suggest → side-by-side paused players
showing BOTH cameras at the same shared-clock moment (pick a high-energy moment: the
suggest response can include the correlation peak time) → user scrubs a ± nudge control
(±5 s range, 0.1 s steps; frame-nudge buttons) watching the two frames line up → **Confirm**
persists.

### C. Persistence

`PUT /api/shared-games/{id}/align` with the full offsets list `{offsets: [{shared_game_video_id,
wall_offset}]}` + sets `alignment_confirmed_at` — written ONLY from the Confirm gesture
(gesture-based persistence rule). Either member may redo alignment later (menu item);
last write wins. Alignment state rides `GET /shared-games/{id}` (T5520 propagation already
refreshes local knowledge on load).

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/routers/shared_games.py` — suggest + align endpoints
- NEW `src/backend/app/services/audio_align.py` — envelope extraction + correlation (pure functions, unit-testable without media)
- `src/backend/app/services/ffmpeg_service.py` — existing ffmpeg invocation patterns
- Frontend NEW: `SyncCamerasModal.jsx` (side-by-side confirm UI) + banner on game card / Annotate
- `src/frontend/src/stores/gamesDataStore.js` — alignment status selector
- `src/backend/tests/test_audio_align.py` — NEW (synthetic fixtures)

### Related Tasks
- Depends on: T5520 (both cameras registered + propagated)
- Blocks: T5540 (toggle needs offsets), T5550, T5560
- Related: movement-tracking testbed discipline (validate the algorithm against known ground truth before shipping)

### Technical Notes
- Knowledge docs: [backend-services.md](../../../.claude/knowledge/backend-services.md), [modal-gpu.md](../../../.claude/knowledge/modal-gpu.md) (ffmpeg patterns — this task is CPU-on-Fly, no Modal)
- Compute cost: envelope extraction of 2×90 min at 8 kHz mono is minutes of CPU; run it
  synchronously behind a progress state in v1 (suggest is a rare, explicit action). If Fly
  CPU contention shows up, move to a background job — do not prematurely build that.
- The side-by-side UI mounts two `<video>` elements against presigned sources — reuse the
  existing playback-url plumbing; don't proxy through the 1-vCPU box twice (T4770 lesson).
- **Real-browser verification required** for the nudge UI (pointer/scrub interaction —
  jsdom false-confidence rule).
- UI Designer pass for the modal (it teaches a novel concept in one screen).

## Implementation

### Steps
1. [ ] `audio_align.py` + unit tests against synthesized known-offset fixtures (±0.2 s)
2. [ ] Suggest endpoint (envelopes from R2, coarse→fine correlation, confidence)
3. [ ] UI Designer: sync modal spec — approval gate
4. [ ] Confirm/nudge modal + banner + gesture-persisted PUT
5. [ ] Validation run on 2-3 real split-video pairs (document recovered vs known offsets in the task log)
6. [ ] Tests: suggest confidence paths (good/low/no-audio), PUT permissions (member-only), NULL-offset never silently zeroed

## Acceptance Criteria

- [ ] Auto-suggest recovers known offsets within ±0.2 s on the validation pairs; low/no-audio cases degrade to manual without errors
- [ ] Confirm UI lets a user visually verify and nudge, then persists offsets + `alignment_confirmed_at` on the Confirm gesture only
- [ ] Unaligned cameras are represented as NULL offsets end-to-end (never fabricated 0s); T5540 can rely on that contract
- [ ] Either member can redo alignment; both sides see updated offsets after load
- [ ] Backend unit tests pass; nudge UI verified in a real browser
