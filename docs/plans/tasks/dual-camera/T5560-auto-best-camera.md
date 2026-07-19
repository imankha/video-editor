# T5560: Auto Best-Camera Suggestions

**Status:** BLOCKED (by T5460 Modal movement job + T5540)
**Impact:** 6
**Complexity:** 6
**Created:** 2026-07-19
**Updated:** 2026-07-19

## Problem

With two aligned cameras, the user still has to guess which one filmed a given moment
better. The Movement Tracking epic (T5430-T5490) produces exactly the needed raw material:
a per-second activity profile per source. Comparing the two cameras' profiles on the shared
clock yields a "which camera sees the action" signal for every timestamp.

## Solution

1. **Profiles per source, shared across accounts.** Hard prerequisite (coordinate with
   T5460 BEFORE it lands — cheap then, migration later): the movement-profile artifact is
   keyed by **source blake3**, not by (user, game). Then one member's paid analysis of
   their camera is readable by both members, and a shared game with both cameras analyzed
   has two profiles addressable from either account.
2. **Comparison signal (start simple, validate before shipping).** v1 signal: at shared
   time t, `better(t) = argmax(camera_score(t))` where `camera_score` is the profile's
   normalized activity score resampled onto the shared clock, smoothed with the same
   hysteresis discipline as the movement epic (no strobing switches — min-dwell ≥ 8-10 s,
   switch only on a sustained margin, e.g. score ratio > 1.3 for ≥ 3 s). Note the honest
   caveat: activity score measures *motion seen by that camera*, which is a proxy for
   "action is nearer/better-framed in that camera" — validate the proxy on real
   dual-camera games in the motion testbed (label 10-20 moments per game "which camera is
   better" and report agreement) BEFORE enabling by default. If the proxy is weak, the
   fallback signal is YOLO mean-player-bbox-height per camera (bigger players = closer
   action), which T5450's feature cache already computes.
3. **UI (two layers, both read-only/derived — zero persistence):**
   - **Badge:** while paused or scrubbing in Annotate, if the OTHER camera's score
     meaningfully beats the current one at the playhead, the T5540 toggle button shows a
     subtle pulse/badge ("Better angle available"). Click = normal toggle.
   - **Auto camera mode:** an opt-in toggle next to the camera button; during playback the
     active camera follows `better(t)` at hysteresis boundaries (reusing T5540's mapped
     switch — which preserves the playhead by construction). Any manual toggle suspends
     auto mode for the session (same suspend semantics as T5480 smart playback).
4. **Availability gating:** feature renders ONLY when the shared game has confirmed
   alignment AND both cameras have movement profiles. Anything missing → no badge, no auto
   toggle, no errors (mirror T5470's "no profile = no layer" rule).

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/routers/` movement-profile GET endpoint (created by T5460) — must accept per-source addressing for both cameras of a shared game
- `src/frontend/src/modes/annotate/` — NEW `useBestCamera.js` pure hook (profiles + offsets → `better(t)` with hysteresis) + badge/auto-mode wiring into the T5540 toggle
- `src/frontend/src/modes/annotate/utils/cameraTimeMap.js` — shared-clock resampling reuse
- `src/backend/experiments/motion_testbed/` — proxy-validation run (dual-camera games)
- `.claude/knowledge/modal-gpu.md` — profile keying notes to update

### Related Tasks
- **BLOCKED by: T5460** (profile artifact + persistence — and the per-source keying must be agreed with that task NOW), **T5540** (toggle machinery), T5530 (alignment)
- Reuses: T5450 feature cache (bbox-height fallback signal), T5470 gating pattern, T5480 suspend semantics
- Part of [dual-camera epic](EPIC.md)

### Technical Notes
- Knowledge docs: [annotate.md](../../../.claude/knowledge/annotate.md), [modal-gpu.md](../../../.claude/knowledge/modal-gpu.md), [movement-tracking/EPIC.md](../movement-tracking/EPIC.md)
- `useBestCamera` must be a PURE hook over (profileA, profileB, offsets, t) — exhaustively
  unit-tested like T5480's playback state machine; the component layer just renders it.
- The movement epic's asymmetry lesson applies in miniature: a wrong auto-switch AWAY from
  a goal is far worse than a missed suggestion — tune dwell/margin conservatively and keep
  the ±10 s protected-zone idea if profiles expose spikes.
- Business note for design: movement analysis is a paid add-on (T5490) — the shared-game
  pitch ("analyze once, both parents benefit") is a selling point; who pays for the second
  camera's analysis is a product decision to surface to the user in design, not to solve
  silently in code.

## Implementation

### Steps
1. [ ] NOW (before T5460 lands): agree per-source (blake3) profile keying with T5460's design
2. [ ] Testbed proxy validation on real dual-camera games (activity-score vs labeled "better camera"; bbox-height fallback comparison) — go/no-go on the v1 signal
3. [ ] `useBestCamera` pure hook + unit tests (hysteresis, dwell, margins, gaps, missing profiles)
4. [ ] Badge + auto-camera mode wired into T5540 toggle; availability gating
5. [ ] Real-browser verification on a fully-set-up shared game

## Acceptance Criteria

- [ ] Profiles are per-source addressable; both members can read both cameras' profiles
- [ ] Proxy validation report committed (agreement % vs human "better camera" labels); v1 signal choice recorded
- [ ] Badge appears only on a sustained, meaningful margin; auto mode switches smoothly with no strobing (dwell/margin unit-tested)
- [ ] Manual toggle suspends auto mode for the session
- [ ] Missing alignment/profile degrades to nothing — no badge, no errors
- [ ] Hook unit tests pass; real-browser verification done
