# Epic: Video Load Reliability

**Status:** DONE (2026-04-12)
**Created:** 2026-04-12
**Owner:** orchestrator agent (see [kickoff prompt](#orchestrator-kickoff) below)

## Goal

Make video loading robust against blob-URL staleness, oversized preloads, and CORS noise. Every task in this epic delivers **user-visible value** that is **verifiable by a test run before and after the change**.

All three tasks touch the same code path (`useVideo.js` + `AnnotateContainer.jsx` blob preload added in T1262 + `cacheWarming.js`). The path fell out of the T1262 merge and the sarkarati@gmail.com 2026-04-10 production report.

## Priority (severity to user experience — unblock users first)

| # | ID | Task | User Value | Verifiable By |
|---|----|------|------------|---------------|
| 1 | T1360 | [Blob URL Error Recovery](T1360-blob-url-error-recovery.md) | User never sees the misleading "Video format not supported" error; video auto-recovers from revoked blob | E2E test that revokes a blob URL mid-playback and asserts no error overlay + video resumes from the streaming URL |
| 2 | T1370 | [Blob Preload Size Gate + Unmount Safety](T1370-blob-preload-size-gate.md) | **OBSOLETE** — T1262 (the preload) was reverted in `e4f5fec` before epic start; symptom cannot occur | n/a (closed 2026-04-12 without implementation) |
| 3 | T1350 | [Cache Warming CORS Cleanup](T1350-cache-warming-cors-fix.md) | Console is clean; real errors no longer buried under CORS spam on every page load | Playwright test that asserts zero CORS errors in `page.on('console')` during `warmAllUserVideos()` |

## Shared Context

### Files in this code path
- `src/frontend/src/hooks/useVideo.js` — video element lifecycle, error handling, URL loading
- `src/frontend/src/containers/AnnotateContainer.jsx` — owns `preloadVideoAsBlob` (T1262)
- `src/frontend/src/components/VideoPlayer.jsx` — error overlay rendering
- `src/frontend/src/utils/cacheWarming.js` — R2 presigned URL warmup
- `src/frontend/src/App.jsx` — calls `warmAllUserVideos()` on mount

### Prior art
- T1262 added the blob preload (commit `d9a8491`) — source of the stale-blob path.
- T1380 (DONE) — moov faststart; unrelated but touches the same upload → playback flow.
- T1260 epic (ICE) — further seek optimizations intentionally paused.

### Known behaviors to preserve
- Streaming range-request playback must continue to work on all videos.
- Dedup via BLAKE3 of original file (T1380 invariant) — not touched by this epic.
- Gesture-based persistence rule (no reactive writes) — none of these tasks should add `useEffect` persistence.

## Measurement Protocol (per-task)

Every task follows this loop:

1. **Before:** write the failing test first, run it, record the failure mode (error text, log line, count, latency — whatever the task's value metric is).
2. **Implement** on a task-specific branch: `feature/T{id}-{slug}`.
3. **After:** re-run the test, record the pass. Diff the before/after numbers in the task file's "Result" section (mirror T1380's pattern).
4. **Merge** the task branch into `master` only after the test passes. Do not batch multiple tasks into one merge.
5. **Report back** to the orchestrator: what changed, what downstream tasks should know, any surprises.

## Merge Policy

- One branch per task (`feature/T1360-blob-url-error-recovery`, `feature/T1370-blob-preload-size-gate`, `feature/T1350-cache-warming-cors-fix`).
- Merge only after: (a) the before/after test exists and passes, (b) user has approved via "complete"/"done". AI only sets status to TESTING.
- No `--no-verify`. Squash-or-merge-commit per user's standing preference (check recent merges on master).

## Orchestrator Kickoff

See [ORCHESTRATOR-KICKOFF.md](ORCHESTRATOR-KICKOFF.md) for the self-contained prompt that starts the cascade.
