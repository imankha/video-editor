# T1530: Comprehensive Profiling Strategy for Non-Responsive Calls

**Status:** TODO
**Impact:** 8 (responsiveness is table-stakes; today we guess at root causes)
**Complexity:** 5
**Created:** 2026-04-15
**Updated:** 2026-04-15

## Problem

Users are seeing UI stalls (60s "Loading Games" freeze observed on staging RC) and video-load oddities (`range_fallback_suspected ratio=66x`). Our current instrumentation tells us *that* something was slow — `[SLOW DB SYNC]`, `[SLOW REQUEST]`, `[VIDEO_LOAD] range_fallback_suspected`, newly added `[REQ_TIMING]` and `[LONGTASK]` — but not *why* at the function-call level. Every investigation so far ends with "probably R2 retries" or "probably padding" because we lack call-level timing.

We should be able to answer, for any request that exceeds a latency budget: **"which function call is spending the time?"** without adding a print to every handler.

## Goal

Introduce a profiling layer that:
1. Runs on the hot request path (opt-in, low overhead, togglable via env/header).
2. Captures a cProfile-style call tree for any request that exceeds a latency threshold.
3. Stores the profile artifact somewhere retrievable by developers (disk, R2, or exposed endpoint).
4. Does the same on the frontend for user-perceived stalls (long tasks, slow store mutations, slow fetches).

## Existing Instrumentation (baseline to build on)

### Backend
- [src/backend/app/middleware/db_sync.py](src/backend/app/middleware/db_sync.py)
  - `[SLOW DB SYNC]` — warn if R2 sync > 0.5s
  - `[SLOW REQUEST]` — warn if total > 0.2s
  - `[REQ_TIMING]` (new) — per-request structured: `total_ms handler_ms sync_ms inflight_entry inflight_exit`
  - `_INFLIGHT` counter — detects per-user request queueing
- `[SYNC_PARTIAL]` (T1154), `[PROFILE] R2 sync` (behind `PROFILING_ENABLED` env)

### Frontend
- [src/frontend/src/utils/responsiveness.js](src/frontend/src/utils/responsiveness.js) (new) — `[LONGTASK]` via `PerformanceObserver`, `profileSlow(label, fn, threshold)`
- [src/frontend/src/utils/videoLoadWatchdog.js](src/frontend/src/utils/videoLoadWatchdog.js) — `[VIDEO_LOAD]` watchdog + range fallback detection
- [src/frontend/src/utils/videoLoadRoute.js](src/frontend/src/utils/videoLoadRoute.js) — `[ROUTE] DIRECT_WARM` diagnostic (new)
- `[CacheWarming] Warmed clip` — byte ranges of warms

### Gap
None of the above tells us, for a 12s `/exports/acknowledge`, whether the seconds went to:
- R2 HEAD (version check)
- R2 PUT (upload)
- botocore retry sleeps
- sqlite WAL checkpoint
- pickle/JSON serialization of response
- async context switching

We need a call tree.

## Proposed Approach

### Backend: request-scoped cProfile middleware

New middleware (or option inside `RequestContextMiddleware`) that:

1. **Trigger policy.** Do NOT profile every request. Options:
   - Env var `PROFILE_REQUESTS=1` → profile all requests. Dev/debug only.
   - Header `X-Profile-Request: 1` → profile on demand (curl / devtools override).
   - Auto-profile on breach: wrap the request and if it exceeds `PROFILE_ON_BREACH_MS` (e.g. 1000ms), emit the profile. Caveat: we need the profiler running before the breach, which means we profile speculatively and discard on fast requests. Use `cProfile.Profile()` + `enable()` / `disable()` — the overhead is ~5-15% which we accept for the signal.
   - Sample 1-in-N policy for production tailing.

2. **Capture.**
   ```python
   import cProfile, pstats, io
   prof = cProfile.Profile()
   prof.enable()
   try:
       response = await call_next(request)
   finally:
       prof.disable()
       if should_emit(elapsed):
           save_profile(prof, request, elapsed)
   ```

3. **Storage.** Three options:
   - **Disk, rotating.** `/tmp/profiles/{ts}_{method}_{path_sanitized}_{ms}.prof` — cheap, requires shell access to retrieve.
   - **R2, prefixed.** Upload as `profiles/{user_id}/{ts}.prof` — retrievable from anywhere. Needs a cleanup policy.
   - **HTTP response header + in-memory ring buffer.** Simplest for dev: keep last 20 profiles, expose at `GET /api/_debug/profiles`.

   Recommend: disk for dev/staging, gated by env; no prod storage until we decide retention.

4. **Viewing.** `python -m pstats /tmp/profiles/xxx.prof`, or `snakeviz xxx.prof` for flame-graph. Document the command in a runbook.

5. **Gotchas.**
   - cProfile only profiles the thread that calls `enable()`. The `ThreadPoolExecutor` sync (`sync_db_to_r2_explicit` on separate threads) will NOT appear in the tree. Address with a separate thread-local profiler inside `_sync_profile` / `_sync_user` that merges back, OR accept the gap and add explicit `time.perf_counter()` around the executor `.result()` calls (already partly done).
   - asyncio yield points don't stop the profiler — total wall time still includes await'd network. That's what we want for "why was this slow."
   - Don't wrap the entire middleware stack; the profile root should be the handler, not the middleware chain itself.

6. **R2 client instrumentation.** Add a botocore event hook that logs each S3 operation's wall time:
   ```python
   def _on_after_call(operation_name, **kwargs):
       logger.info(f"[R2_CALL] op={operation_name} elapsed_ms={...}")
   client.meta.events.register('after-call.s3.*', _on_after_call)
   ```
   Complements cProfile for network-bound breakdown.

### Frontend: user-timing + explicit traces

1. **User Timing API.** Wrap key async paths with `performance.mark()` / `performance.measure()`:
   - `games:fetch`, `project:load`, `clip:extract`, `export:start`, `video:load`
   - Emit a structured `[TIMING]` console log for any measure exceeding a per-label threshold.
   - DevTools Performance panel will render these as a timeline automatically.

2. **Fetch wrapper.** Add a `profiledFetch(label, url, opts, thresholdMs)` util that wraps `fetch`, logs total + time-to-first-byte + response-body-read. Use on store-level fetches.

3. **Store action wrapping.** Many Zustand actions are async and fan out into renders. Wrap the slowest ones (`gamesDataStore.fetchGames`, `projectsStore.loadProject`, `editorStore.saveCurrentClipState`) with `profileSlow` from the new `responsiveness.js`.

4. **React profiler (dev only).** Gate a `<Profiler>` wrapper around top-level screens so dev builds emit render-cost measurements.

5. **Navigation Timing API.** On route changes, log `navigation.duration` breakdown (redirect, DNS, connect, request, response, DOM parse). One-liner via `PerformanceObserver({ entryTypes: ['navigation'] })`.

## Acceptance Criteria

- [ ] Backend: setting `PROFILE_REQUESTS=1` produces a `.prof` file for each request. `python -m pstats` reveals per-function time breakdown.
- [ ] Backend: auto-profile on breach (>1000ms) produces a `.prof` file without dev intervention; verify by stalling R2 and hitting any write endpoint.
- [ ] Backend: `[R2_CALL]` logs emitted for every S3 operation in sync path.
- [ ] Backend: ThreadPoolExecutor-bound sync work is either included in the profile or explicitly timed alongside it.
- [ ] Frontend: `performance.getEntriesByType('measure')` shows named spans for fetch / load / export paths.
- [ ] Frontend: DevTools Performance recording of a normal session shows named user-timing marks visible in the timeline.
- [ ] Frontend: `[TIMING]` logs surface slow named operations with label + ms.
- [ ] Runbook (`docs/runbooks/profiling.md`) documents how to: (a) enable profiling, (b) capture, (c) retrieve, (d) view in snakeviz / devtools.
- [ ] Zero measurable overhead when profiling is disabled (verify with a before/after benchmark on a GET /api/games — < 1ms median delta).

## Out of Scope

- Distributed tracing (OpenTelemetry / Jaeger). Overkill for a single-tenant Fly deployment. Reconsider when we add a second service.
- Log aggregation / dashboards. Stay with grep-able structured logs until volume demands more.
- Always-on sampling in prod. Decide only after we've used profiles to fix 2-3 real slowdowns.

## Notes for AI handoff

- The existing `[REQ_TIMING]` and `[LONGTASK]` instrumentation is already capturing the symptom. This task adds *function-level attribution*.
- Check [src/backend/app/storage.py](src/backend/app/storage.py) for where the boto3 client is created — that's the natural place to register the event hook.
- The db_sync middleware already distinguishes `handler_duration` from `sync_duration`. Preserve that separation in profile output.
- Do NOT regress commit message ASCII rule (see `.claude/skills/commit/SKILL.md`) — `snakeviz` etc. should be spelled out without smart quotes.
- Write a failing test where possible: e.g., a test that asserts `PROFILE_REQUESTS=1` causes a `.prof` file to be created on the first request.
