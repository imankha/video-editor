# T4320: Durable Sync for Clip-Creating Gestures + user.sqlite Shutdown Sync

**Status:** TODO
**Impact:** 7
**Complexity:** 3
**Created:** 2026-07-03
**Epic:** [durability-sync](EPIC.md) · Audit item B3

## Problem

Annotation work is never durable. Non-durable requests sync fire-and-forget after the response (`middleware/db_sync.py:683-693`) with a 0.5s upload-lock timeout (`db_sync.py:199-201`; defer → `.sync_pending` marker via `storage.py:911-918`). `Depends(durable_sync)` exists but is applied only to publish/restore/overlay-export (`downloads.py:818, 923`, `overlay.py:827, 1155`).

Concrete loss scenario: user annotates a game while an export worker holds the R2 upload lock (~14s, T2720); every `POST /clips/raw/save` returns success + toast but defers its sync; the machine is replaced before a retry → **the entire annotation session reverts**. Also: graceful shutdown syncs only `profile.sqlite`, not `user.sqlite` (`main.py:255-276`).

Exposure: annotate = the onboarding path; "my clips disappeared" is a first-session killer.

## Solution

1. Add `Depends(durable_sync)` to the clip-creating/mutating gestures: `POST /clips/raw/save`, `PUT /clips/raw/{id}`, `DELETE /clips/raw/{id}` (clips.py:911/1052/…) and game finalize (`games_upload.py:262`). Working-clip actions (`/actions`) are higher-frequency — measure first (step 2) before including them; if latency allows, include; if not, document the decision and rely on T4310's conflict detection as the backstop.
2. **Measure the latency cost first**: `durable_sync` waits on the R2 upload with no timeout. Instrument (profiling runbook, req_id chain) an annotate session on staging; if p95 save > ~1.5s, the fix needs a bounded wait + explicit `sync_pending` response the frontend surfaces (not a silent toast-success), rather than an unbounded one.
3. Add `user.sqlite` to the graceful-shutdown sync in `main.py` (mirror the profile.sqlite block).

## Context

- Files: `src/backend/app/middleware/db_sync.py`, `src/backend/app/routers/clips.py`, `src/backend/app/routers/games_upload.py`, `src/backend/app/main.py`
- Read `durable_sync`'s implementation and its overlay/downloads usage before wiring — match the existing pattern exactly.
- Related: T4200 (same boundary for export announcements); T1540 (prior lost-clips-during-upload incident — its test may be extendable).

## Steps

1. [ ] Instrument + measure current durable_sync latency on staging (real R2).
2. [ ] Decision in Progress Log: unbounded wait vs bounded+surfaced, per measurements.
3. [ ] Test: machine-replacement simulation (T4120 seams) — clip saved with success response survives; shutdown sync covers user.sqlite.
4. [ ] Apply dependencies; run backend tests; drive a real annotate session (drive-app-as-user) checking save latency feel.

## Acceptance Criteria

- [ ] A clip save that returned success survives machine replacement (seam-tested)
- [ ] user.sqlite included in shutdown sync
- [ ] Measured latency documented; annotate saves stay responsive (p95 documented)
- [ ] Any `sync_pending` outcome is user-visible, never a silent success
