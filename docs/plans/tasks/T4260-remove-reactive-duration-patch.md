# T4260: Remove Reactive Game-Duration PATCH (Last Banned effect→API Write)

**Status:** STAGING
**Impact:** 6
**Complexity:** 3
**Created:** 2026-07-03
**Source:** Code quality audit ([audit-2026-07-03-code-quality.md](../audit-2026-07-03-code-quality.md) items A8 / F12)

## Problem

**Exposure: fires on every Annotate video load — Annotate is the onboarding critical path (first-session upload → annotate).**

The audit swept every container/screen/hook for the banned reactive-persistence pattern (`useEffect` watching state → backend write). Exactly ONE survives: `AnnotateContainer` watches video metadata and, when the `<video>` element reports a longer duration than the DB, PATCHes `/api/games/{id}/duration` — no user gesture.

Why this is dangerous, not helpful:
- A partially-buffered stream, a proxy serving a wrong byte range, or a mid-load src swap (the T4000 early-src path sets src *before* game data arrives) can report a bogus duration that gets **persisted and then trusted by the streaming proxy**.
- Two open tabs with differently-buffered elements can ping-pong the value.
- It's a defensive fix for internal data: the comment says DB duration "can be truncated if ffprobe ran on an incomplete upload" — that's the bug to fix, at the source.

## Root Cause (verified)

- `src/frontend/src/containers/AnnotateContainer.jsx:1115-1158` — effect; PATCH at `:1143-1147` with `.catch(() => {})` (silent failure too).
- Source bug it papers over: ffprobe runs on an incomplete upload somewhere in the upload/activate flow — find it in `src/backend/app/routers/games_upload.py` (finalize) and/or `games.py` `activate_game` (probe at ~`:627`).

## Solution

1. **Frontend:** delete the PATCH call from the effect. KEEP the memory-only `setAnnotateVideoMetadata` fixup (runtime fixups are memory-only — that's the rule). Add the standard `console.warn` when element duration exceeds DB duration by >1s, so the mismatch stays visible.
2. **Backend, fix the source:** ensure the duration stored at upload finalize is probed from the COMPLETE file. Read the finalize/activate flow and find where ffprobe can see an incomplete file; probe after the upload is fully assembled (post-multipart-complete / post-R2-write). If activation already re-probes (`activate_game` has an ffprobe-over-R2 step), determine why truncated durations still occurred before touching anything — reproduce first, or document that the reactive PATCH's premise can no longer occur.
3. **Endpoint disposition:** `grep -rn "games/.*duration" src/frontend/src src/backend` — if the PATCH endpoint has no remaining callers, delete it (dead write path). If an admin/heal flow uses it, keep it and note that in the task log.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/containers/AnnotateContainer.jsx`
- `src/backend/app/routers/games_upload.py` — finalize flow
- `src/backend/app/routers/games.py` — `activate_game` probe, the PATCH endpoint

### Related Tasks
- The audit's F1 guardrail task (ESLint no-persistence-in-effects) will lint-ban this pattern; this task removes the last violation so the lint lands clean.

### Technical Notes
- Multi-video games already skip this effect (`if (gameVideos) return` at `:1118`) — your change only affects single-video games; keep it that way.
- Test the annotate load path after removal: metadata still corrects in-memory (scrub bar length right) even when DB duration is short.

## Implementation

### Steps
1. [ ] Reproduce/verify the source bug: can finalize store a truncated duration today? (Read the flow; try an interrupted-then-resumed upload on dev.) Write down the finding in this file's Progress Log.
2. [ ] Backend fix (or documented non-repro) + test.
3. [ ] Remove the frontend PATCH; keep memory fixup + warn.
4. [ ] Endpoint disposition per grep.
5. [ ] Frontend build check + backend import check + affected tests.

## Acceptance Criteria

- [ ] Zero `useEffect`-triggered backend writes remain in the frontend (grep-verifiable)
- [ ] Stored game duration is correct at finalize (test or documented non-repro)
- [ ] In-memory metadata fixup still works; mismatch logs a warning
- [ ] Dead endpoint removed if unreferenced
