# T5480: Smart Playback

**Status:** TODO
**Impact:** 8
**Complexity:** 5
**Created:** 2026-07-19

## Problem

Seeing dead time (T5470) still leaves the annotator manually scrubbing past it. Smart playback should do it for them: normal speed through play, automatic skim speed through dead ball, hard skip over long empty stretches (halftime) — while guaranteeing they never blast past real action. See [EPIC.md](EPIC.md) smart-playback semantics for the full product spec and the protected-zone rule.

## Solution

A client-side playback state machine in Annotate driven by the loaded movement profile: `ACTIVE` → user speed; `DEAD` → skim speed (default 4x, configurable 2–8x); `EMPTY` > 2 min → seek past with a toast + undo. Pure `video.playbackRate`/`currentTime` manipulation — no re-encode, no backend, no persistence beyond one real preference.

## Context

### Relevant Files (REQUIRED)
(confirm exact seams at task start via `.claude/knowledge/annotate.md`)
- `src/frontend/src/components/annotate/VideoPlayer.jsx` — playbackRate/seek control point
- `src/frontend/src/screens/AnnotateScreen.jsx` — smart-mode toggle wiring
- New `src/frontend/src/hooks/useSmartPlayback.js` — the state machine (pure logic, unit-testable): given (currentTime, profile.states, scores, settings) → {targetRate, pendingSkip}
- Toast/undo: reuse the app's existing toast component
- Unit tests for the hook (timeline fixtures covering every transition case) + e2e

### Related Tasks
- Depends on: T5470 (profile already fetched in the annotate store; visual layer gives the user context for what's being skipped)
- Blocks: — (last feature task; T5490 is gating/pricing)

### Technical Notes
- **State machine rules** (from EPIC.md):
  - Enter skim only when playhead is ≥ 2 s INTO a `DEAD` span; return to user speed 2 s BEFORE the next `ACTIVE` start (lead-in; G4 boundary accuracy makes this safe).
  - `EMPTY` span > 120 s → seek to (span end − 2 s), toast "Skipped 12:04 — halftime" with an Undo that seeks back to the skip origin.
  - **Protected zones**: never skim/skip within ±10 s of a top-decile score spike (compute spike set once from `scores` at profile load). Belt-and-suspenders around goals/celebrations.
  - Any manual user interaction (seek, pause, speed change) suspends smart adjustments for 5 s (user intent wins; no rate-flapping fight).
- **Rate handling**: smart mode multiplies over the user's chosen base speed; restore exact prior rate on exit from skim or toggle-off. Beware `ratechange` listeners elsewhere — search for existing playbackRate consumers before wiring.
- **Persistence**: skim-speed setting (2–8x) is a genuine user preference — persist via a gesture-triggered settings write ONLY if a matching preferences surface already exists; otherwise session-only for now (note follow-up). Smart-mode toggle itself: session-only (no persisted view state).
- **The hook is pure**: all decisions from inputs → outputs; the component applies them. No effect writes to any store the hook reads (loop risk). Unit-test the pure hook exhaustively — this is the component whose failure mode is "parent missed the goal".
- **Instrumentation** (product KPIs, EPIC.md): analytics events for smart-mode on/off, seconds skimmed/skipped per session, undo-after-skip (the "it skipped something real" proxy).

## Implementation

### Steps
1. [ ] `useSmartPlayback` pure hook + exhaustive unit tests (fixtures: mid-DEAD entry, lead-in exit, EMPTY skip, protected zone, manual-interaction suspension)
2. [ ] Wire into VideoPlayer/AnnotateScreen; toggle UI (UI Designer consult for control placement)
3. [ ] Toast + undo; skim-speed control
4. [ ] Analytics events
5. [ ] e2e: seeded profile → assert rate changes and skip behavior
6. [ ] Real-browser verification on staging with a real profiled game (drive-app-as-user; pointer/playback behavior must NOT be trusted to jsdom — per project feedback memory)

### Progress Log

**2026-07-19**: Task created.

## Acceptance Criteria

- [ ] With smart mode on: skim through DEAD, 1x through ACTIVE, halftime hard-skipped with toast + working undo
- [ ] Lead-in verified: playback is at user speed ≥ 2 s before each ACTIVE start in an e2e fixture
- [ ] Protected zones verified: no skim within ±10 s of top-decile spikes
- [ ] Manual seek/pause immediately suspends smart control; no rate flapping
- [ ] Hook unit tests cover every transition case; e2e passes; verified in a real browser on staging
