# T5560: Auto Best-Camera Suggestions

**Status:** BLOCKED (by T5460 Modal movement job + T5540)
**Impact:** 6
**Complexity:** 6
**Created:** 2026-07-19
**Updated:** 2026-08-19

## Problem

With multiple aligned feeds, the user still has to guess which camera filmed a given
moment better. The Movement Tracking epic (T7060-T7080, T5460-T5490) produces exactly the
needed raw material: a per-second activity profile per source. Comparing feeds' profiles
on the shared clock yields a "which camera sees the action" signal for every timestamp.

## Solution

1. **Profiles per source, shared across accounts.** Hard prerequisite (coordinate with
   T5460 BEFORE it lands — cheap then, migration later; [EPIC.md](EPIC.md) decision 10):
   the movement-profile artifact is keyed by **source blake3**, not (user, game). Computed
   once, valid for every account referencing the source — one member's paid analysis
   benefits the whole pool; T5560 gets other members' profiles for free.
2. **Comparison signal (start simple, validate before shipping).** At shared time t,
   `better(t) = argmax over covering feeds(feed_score(t))` — N feeds, not a pair —
   where `feed_score` is the profile's normalized activity resampled onto the shared
   clock, smoothed with the movement epic's hysteresis discipline (min-dwell ≥ 8-10 s,
   switch only on a sustained margin, e.g. ratio > 1.3 for ≥ 3 s). Honest caveat:
   activity measures *motion seen by that camera*, a proxy for "action is nearer/
   better-framed" — validate on real multi-feed games in the motion testbed (label 10-20
   moments per game) BEFORE enabling by default. Weak proxy → fallback signal is YOLO
   mean-player-bbox-height per feed (T7080's feature cache already computes it).
3. **UI (read-only/derived — zero persistence):**
   - **Badge:** while paused/scrubbing, if another covering feed's score meaningfully
     beats the watched one at the playhead, a subtle "Better angle available" pulse on the
     active-camera surface (lane label / mobile chip — T5540's machinery). Click/tap =
     the normal session switch.
   - **Auto mode — the Main→"Auto" rename:** per UX-SPEC § Vocabulary, "Main" is the
     honest name until THIS task earns **"Auto"** (`Star` glyph → `Wand2`): opt-in; during
     playback the resolved feed follows `better(t)` at hysteresis boundaries within
     Main's existing precedence (explicit clip stamps and preference spans still win —
     the auto signal replaces only the reference-feed default). Any manual switch
     suspends auto for the session (T5480 suspend semantics).
4. **Availability gating:** renders ONLY when the feed's alignment is confirmed AND
   covering feeds have movement profiles. Anything missing → no badge, no auto, no errors
   (T5470's "no profile = no layer" rule).

## Context

### Relevant Files (REQUIRED)
- Movement-profile GET endpoint (created by T5460) — per-source (blake3) addressing for all of a pool's feeds
- `src/frontend/src/modes/annotate/` — NEW `useBestCamera.js` pure hook (profiles + offsets → `better(t)` with hysteresis) + badge/auto wiring into T5540's lanes/chip + `resolveMainFeed`
- `src/frontend/src/modes/annotate/utils/feedTimeMap.js` — shared-clock resampling reuse (T5540)
- `src/backend/experiments/motion_testbed/` — proxy-validation run (multi-feed games)
- `.claude/knowledge/modal-gpu.md` — profile keying notes to update

### Related Tasks
- **BLOCKED by: T5460** (profile artifact — per-source keying must be agreed NOW), **T5540** (lanes + Main resolution), T5530 (alignment verdicts)
- Reuses: T7080 feature cache (bbox fallback), T5470 gating, T5480 suspend semantics
- Part of [Game Pools epic](EPIC.md); UX-SPEC § Vocabulary owns the Main→Auto rename

### Technical Notes
- Knowledge docs: [annotate.md](../../../../.claude/knowledge/annotate.md), [modal-gpu.md](../../../../.claude/knowledge/modal-gpu.md), [movement-tracking/EPIC.md](../movement-tracking/EPIC.md)
- `useBestCamera` must be PURE over (profiles, offsets, t) — exhaustively unit-tested like
  T5480's playback state machine; components just render it. Zero persistence: badge,
  auto mode, and suspensions are all session/derived state — no write gestures exist here
- Asymmetry lesson in miniature: a wrong auto-switch AWAY from a goal is far worse than a
  missed suggestion — tune dwell/margin conservatively; keep the ±10 s protected-zone idea
  if profiles expose spikes
- Business note for design: movement analysis is a paid add-on (T5490) — "analyze once,
  every family benefits" is a selling point; who pays for additional feeds' analysis is a
  product decision to surface, not to solve silently in code

## Implementation

### Steps
1. [ ] NOW (before T5460 lands): agree per-source (blake3) profile keying with T5460's design
2. [ ] Testbed proxy validation on real multi-feed games (activity vs labeled "better camera"; bbox fallback comparison) — go/no-go on the v1 signal
3. [ ] `useBestCamera` pure hook + unit tests (hysteresis, dwell, margins, gaps, missing profiles, N>2 feeds)
4. [ ] Badge + auto mode into T5540's lanes/chip + `resolveMainFeed`; Main→Auto rename (label + `Wand2` glyph per UX-SPEC Vocabulary); availability gating
5. [ ] Real-browser verification on a fully-set-up pool game

## Acceptance Criteria

- [ ] Profiles are per-source addressable; every member can read every feed's profile
- [ ] Proxy validation report committed (agreement % vs human labels); v1 signal choice recorded
- [ ] Badge appears only on a sustained, meaningful margin; auto mode switches smoothly with no strobing (dwell/margin unit-tested); clip stamps and preference spans still outrank the auto signal
- [ ] Manual switch suspends auto for the session; missing alignment/profile degrades to nothing — no badge, no errors
- [ ] "Main" renames to "Auto" (`Wand2`) only with this task; hook unit tests pass; real-browser verification done
