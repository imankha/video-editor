# T4490: Working-Video Single Owner State Machine

**Status:** TODO
**Impact:** 8
**Complexity:** 6
**Created:** 2026-07-03
**Epic:** [editor-decoupling](EPIC.md) · Audit items D3 + G2-partial · Best after T4480

## Problem

[SYNC][DEP] The working video's truth is spread across: `projectDataStore.workingVideo` (:45, :362), `overlayStore.isLoadingWorkingVideo` (:30, :44 — set by **FramingScreen** :912-962/:954 as a cross-screen pre-navigation signal), `project.working_video_url/_id` (projectsStore), and OverlayScreen's local guards (`workingVideoFetchIdRef`, `workingVideoRecoveryAttemptedRef`, `workingVideoAttemptsRef`, `workingVideoLoadError` useState — :137-142). A 65-line effect (:328-392) reconciles them, including a reactive `refreshProject()` recovery branch (:374-379).

This is the locus of the export→overlay handoff bug family (T1670 stuck-loading, stale video) — every new failure mode has added another ref. Overlay cannot be tested without Framing having pre-set store state.

## Solution

One owner in `projectDataStore`:

```
workingVideo: { status: 'idle'|'loading'|'ready'|'error', video: {...}|null, error: string|null }
loadWorkingVideo(projectId): action — the ONLY writer (dedup: concurrent calls share one in-flight promise, per the T2510 _fetchPromise house pattern)
```

- OverlayScreen subscribes and renders per status; ALL guard refs + the reconcile effect + `workingVideoLoadError` are deleted.
- FramingScreen stops writing `overlayStore.isLoadingWorkingVideo`; post-export it simply triggers `loadWorkingVideo(projectId)` (or the T4480 navigation payload carries "expect new working video" and Overlay's mount calls the action). `overlayStore.isLoadingWorkingVideo` is deleted.
- Recovery (the :374-379 refreshProject branch) becomes an explicit retry path INSIDE the action with a bounded attempt count — one place, testable.

## Context

- Files: `stores/projectDataStore.js`, `stores/overlayStore.js`, `screens/OverlayScreen.jsx`, `screens/FramingScreen.jsx:912-962`
- Map EVERY current reader/writer first: `grep -rn "workingVideo\|isLoadingWorkingVideo" src/frontend/src` — table in the Progress Log with its replacement.
- The T1670/T2720/T4110 task files document the historical failure modes this area must keep handling: proxy 206 masking, post-export sync stall, machine-cycle staleness. The state machine must represent each as a normal `error`/retry, not a new ref.
- Gesture rule: `loadWorkingVideo` runs on screen entry/navigation (data loading — allowed) — it must never WRITE anything besides its own store slice.

## Steps

1. [ ] Reader/writer inventory table.
2. [ ] State machine + action with unit tests: dedup, retry bound, every historical failure mode as a transition.
3. [ ] Migrate OverlayScreen (delete refs/effect); migrate FramingScreen producer side.
4. [ ] Delete `overlayStore.isLoadingWorkingVideo`; E2E export→overlay + failure-injection (dev seam) for the stuck-loading case.

## Acceptance Criteria

- [ ] One writer for working-video state; zero guard refs in OverlayScreen
- [ ] Overlay mounts and loads with NO Framing-written state (feeds T4530)
- [ ] Historical failure modes covered as explicit transitions with tests
- [ ] Export→overlay E2E green including a forced-failure retry
