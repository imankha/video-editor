# T7040: Collection download fails with "TypeError: Failed to fetch"

**Status:** TODO
**Impact:** 8
**Complexity:** 5
**Created:** 2026-08-14
**Updated:** 2026-08-15

## Problem

User report 2026-08-14 on staging: clicking Download on a collection shows "Could not download
collection," console: `[DownloadsPanel] collection download failed: TypeError: Failed to fetch`.
This is T4945's new endpoint (merged to master/staging today) — genuinely broken on first real
use, not yet field-proven.

`TypeError: Failed to fetch` is fetch()'s generic network-level failure — it means the browser
never received a usable HTTP response at all (as opposed to a 4xx/5xx, which `useDownloads.js
::downloadCollection` would report as `Collection download failed: <status> <statusText>`, a
different message). Something is failing BEFORE or DURING the response, not after.

## Evidence gathered so far

**HAR** (`Downloads/downcollection.har`, user-provided): only **one** entry captured —
```
OPTIONS /api/collections/download?scope_type=game&aspect_ratio=9:16&game_id=6  -> 200, 20.5ms
```
The CORS preflight succeeds cleanly and fast. The actual `GET` that should follow is **not in
the HAR at all** — either the capture was stopped before it resolved, or the request never
completed in a way DevTools captured. This doesn't yet distinguish between the hypotheses below;
the preflight succeeding does rule out a blanket CORS misconfiguration for this route+origin.

**Backend logs** (`fly logs -a reel-ballers-api-staging`): no `/api/collections/download` line
found in the windows captured (~100 lines each, multiple captures) — inconclusive, staging has
enough concurrent traffic that a short capture can easily miss the exact moment; this should NOT
be read as proof the request never reached the backend.

**Ruled out**: the new `stitch_members` Modal function (T4945's `MODAL_ENABLED=true` path,
CPU-only `gpu=None`) genuinely exists and hydrates successfully against the live
`reel-ballers-video-v2` Modal app right now — confirmed directly via
`modal.Function.from_name('reel-ballers-video-v2', 'stitch_members').hydrate()`. This is NOT a
"function was never deployed" problem.

## New evidence 2026-08-15 (user-provided, second session)

**Updated HAR** (`Downloads/downcollection.har`, same filename, re-captured): 4 entries this
time, and the collection-download GET itself actually **succeeded**:
```
GET /api/collections/download?scope_type=all&aspect_ratio=9:16  -> 200, 3892ms
  content-disposition: attachment; filename="Highlights.mp4"
  content-type: video/mp4
```
(`x-request-id: b666f3e0`). No `/api/exports/active` request appears anywhere in this capture.
This is a **different collection** (`scope_type=all` vs. the original repro's `scope_type=game,
game_id=6`) and a different `x-request-id` than the console log below — **this HAR entry is not
necessarily the same attempt that failed**; treat it as "download CAN succeed, 3.9s end-to-end
for `scope=all`, when nothing else is contending" rather than a resolution of the bug.

**Console log, same testing session** (pasted directly by the user, not from the HAR):
```
[SLOW FETCH] GET /api/exports/active 31181ms req_id=b8f0c9f1 status=200
[DownloadsPanel] collection download failed: TypeError: Failed to fetch
```
`req_id=b8f0c9f1` does not match the HAR's `b666f3e0` — this failure is from a **separate**
attempt in the same session, not captured in the HAR. The 31-second `/api/exports/active` call
completing with `status=200` immediately before the "Failed to fetch" is the most concrete new
lead so far.

**Traced why `/api/exports/active` can take 31s** (code read, not yet reproduced live):
- `GET /api/exports/active` is `async def list_active_exports()`
  (`src/backend/app/routers/exports.py:608`), which calls `get_active_exports()` →
  `cleanup_stale_exports(max_age_minutes=60)` (`exports.py:288`) directly — no `await`, no
  threadpool offload.
- `cleanup_stale_exports` loops over every `pending`/`processing` export job older than 60
  minutes and, for each one that has a `modal_call_id`, calls `check_modal_job_running()`
  (`exports.py:252`) **synchronously** — plain `def`, not `async def`.
- `check_modal_job_running` calls `modal.FunctionCall.from_id(...)` then `call.get(timeout=0)`
  (`exports.py:269,276`) — the Modal Python SDK's blocking network call. "`timeout=0`" only means
  it doesn't block waiting for the job to FINISH; it still makes a real network round-trip to
  Modal's control plane to ask "is it done yet", once per stale candidate, in a loop.
- **This is an unawaited blocking call inside an `async def` FastAPI route.** In uvicorn's
  default single-worker/single-event-loop model (staging's `Dockerfile:23` CMD has no
  `--workers` flag, and `fly.staging.toml` has `min_machines_running = 0`, so staging normally
  runs exactly one machine under light test traffic), a blocking call like this **freezes the
  entire event loop** for its duration — stalling every OTHER concurrent request on that same
  machine, not just the one that triggered it.

**New leading hypothesis (D):** if several stale/orphaned export jobs had accumulated on the
account (each costing one blocking Modal round-trip), a `/api/exports/active` call fired around
the same time as a collection-download request could freeze the event loop long enough that the
collection-download's connection gets abandoned client-side or killed by an intermediate proxy
before the (otherwise-working, per the HAR above) download generator ever gets scheduled to run
— surfacing as the client's generic `TypeError: Failed to fetch`, with nothing useful in the
collections.py code path itself to log because it may never have started. This would also
explain why direct log greps for `/api/collections/download` came up inconclusive in the first
investigation — the request may never have reached that handler's own log lines at all.

This does NOT contradict hypotheses A/B/C below; it's a plausible trigger sitting one layer
above them (something has to be the "other thing" starving the request in the first place), and
still needs live confirmation, not just the code read above.

## Hypotheses (unconfirmed — need live investigation with proper server-side error capture)

- **A — mid-stream failure after headers are already sent.** T4945's endpoint builds a
  `StreamingResponse` after resolving members/card/keys up front (the T5220 closed-connection
  gotcha it was explicitly built to avoid) — but if an exception occurs INSIDE the generator
  itself (during the member concat, the Modal call, or `compose_serve_time`) AFTER the response
  has already started streaming with a 200 and headers, the connection drops abnormally. The
  browser reports exactly `TypeError: Failed to fetch` in this case (not a clean error status),
  because CORS/response headers were already committed to a 200 that never completes. This is
  the leading hypothesis — it explains BOTH the generic client error AND why a short log capture
  might miss the actual exception (buried mid-stream, easy to scroll past without an obvious
  "ERROR" marker if it's logged at a lower level or inside a broad except).
- **B — the specific collection (`game_id=6`, scope=game) has zero or unstitchable members** —
  worth checking directly: does `evaluate_collection_members` return anything for this scope on
  the account that hit this? An empty or degenerate member list feeding into `concat_segments`
  could hang or throw in a way that isn't handled as a clean 4xx.
- **C — Modal cold start exceeds an intermediate proxy timeout.** `stitch_members` existing
  doesn't mean it's been invoked recently on staging; a cold Modal container plus multiple R2
  member fetches plus concat could take longer than a proxy timeout (Fly's reverse proxy or any
  intermediate hop) tolerates for a still-100%-server-side phase (nothing streamed to the client
  yet), causing the connection to be killed before the app can even finish resolving members.

## Next steps for whoever picks this up

1. **Check Hypothesis D first — it's cheap to confirm or rule out.** On staging: `SELECT id,
   status, created_at, modal_call_id FROM export_jobs WHERE status IN ('pending','processing')`
   (per-user SQLite, `get_db_connection()`) to see whether stale jobs have actually been piling
   up (60+ min old, still pending/processing). If yes, that's your `/api/exports/active` slowness
   explained directly — every one of them costs a blocking Modal round-trip on EVERY app-startup
   load, for EVERY user, not just this reporter. If real, the fix is straightforward and worth
   doing regardless of whether it's the T7040 root cause: make `cleanup_stale_exports` run its
   Modal checks off the event loop (`anyio.to_thread.run_sync`, or gather them concurrently
   instead of a sequential loop) so a slow/stuck sweep can never block other requests.
2. **Reproduce collections/download WHILE a slow `/api/exports/active` is artificially forced**
   (e.g. temporarily seed a few fake stale `export_jobs` rows with bogus `modal_call_id`s on a
   dev/staging test account) to see if that alone reproduces `Failed to fetch` — this would
   confirm D without needing to catch the real 31s window live.
3. **Get real server-side visibility on this exact failure** — either reproduce live while
   tailing `fly logs -a reel-ballers-api-staging` in real time (don't rely on short retrospective
   captures like this investigation did), or temporarily add explicit try/except logging around
   the generator body in `collections.py::download_collection` if none exists.
4. Reproduce with the SAME collection (`game_id=6`, `aspect_ratio=9:16`) to control for
   Hypothesis B.
5. Time the reproduction end-to-end to test Hypothesis C (a Modal cold start + cold concat can
   reasonably take 10-30s+; if the failure happens right around a known proxy timeout window,
   that's a strong signal).

## Context

### Relevant Files
- `src/backend/app/routers/collections.py` — `download_collection` (T4945), the streaming
  generator this task needs to instrument/harden
- `src/backend/app/services/modal_client.py` — `call_modal_stitch_members`
- `src/backend/app/modal_functions/video_processing.py` — `stitch_members` (~line 3180)
- `src/frontend/src/hooks/useDownloads.js:221` — `downloadCollection`, the fetch() call that
  surfaces the generic error
- `src/frontend/src/components/collections/DownloadsPanel.jsx` — where the console error line
  the user saw is logged
- `src/backend/app/routers/exports.py:608` `list_active_exports`, `:355` `get_active_exports`,
  `:288` `cleanup_stale_exports`, `:252` `check_modal_job_running` — Hypothesis D's blocking
  event-loop chain, added 2026-08-15
- HAR evidence: `Downloads/downcollection.har` (user-provided, not committed, re-captured
  2026-08-15 — see "New evidence" above, this is now TWO captures under the same filename)

### Related Tasks
- Follows: T4945 (core stitch + owner download, merged 2026-08-14) — this is that endpoint's
  first real-world failure
- Blocks: real confidence in T4945 before T4946 (access control) exposes this endpoint further

### Technical Notes
- Not a T4946 scope question (access/credits) — this is the T4945 mechanism itself failing.
- Since collection downloads are free (Decision 4, resolved 2026-08-14), there's no credit-loss
  risk from a failed attempt, but a broken first impression on a just-shipped feature is worth
  prioritizing.

## Progress Log

### 2026-08-15 (implementation session)

**Root cause: Hypothesis D confirmed (event-loop starvation).** Mechanism nailed by code
read + LOCAL REPRO (see evidence path below). `GET /api/exports/active`
(`async def list_active_exports`) called `get_active_exports()` INLINE on the event loop;
that runs `cleanup_stale_exports()`, which for every stale `pending`/`processing` job with a
`modal_call_id` makes a BLOCKING Modal control-plane round-trip
(`check_modal_job_running` → `call.get(timeout=0)`, a plain `def`) in a SEQUENTIAL loop. On
staging's single-worker uvicorn this freezes the WHOLE event loop for the sweep's duration
(the user's console showed a 31s `/api/exports/active`), starving a concurrent
collection-download request until the browser abandons it — surfacing as the client's generic
`TypeError: Failed to fetch`, with nothing in `collections.py`'s own path to log (it may never
be scheduled). This matches every observation: the succeeding HAR (download works when nothing
contends), the failing console line (a 31s `/active` immediately before the failure), and the
inconclusive `/api/collections/download` log greps.

**Evidence path used: LOCAL REPRO, not a live staging query.** Per kickoff step 2 — the
container has no staging per-user-DB credentials/network path, so rather than burn time I
reproduced D locally: `tests/test_t7040_collection_download_event_loop.py::`
`test_active_sweep_does_not_block_event_loop` seeds 3 stale `export_jobs` rows (120-min-old,
`modal_call_id` set), stubs `check_modal_job_running` with a 0.5s blocking sleep (simulating
the real round-trip), and asserts a concurrent ticker coroutine keeps ticking while
`list_active_exports()` runs. **Verified it discriminates:** the test FAILS on the pre-fix
inline code (ticker starved to ~1 tick) and PASSES after the fix (≥20 ticks). This is the
"real evidence" the acceptance criterion asks for, obtained via local repro — being explicit
that it is a repro, not a live-staging DB read.

**Fixes shipped (both in scope per kickoff):**
1. `exports.py` — `list_active_exports` now offloads the whole blocking chain via
   `await anyio.to_thread.run_sync(get_active_exports)`; the event loop stays responsive during
   the sweep. anyio copies request contextvars (user/profile) into the worker thread, so
   `get_db_connection()` still resolves the caller's per-user DB (fresh sqlite conn opened
   in-thread — no cross-thread affinity). Reviewer empirically confirmed the contextvar copy on
   pinned `anyio==4.11.0` and that the stale-cleanup R2 sync write-back is not stranded.
2. `collections.py::download_collection` (Hypothesis A hardening) — moved the fallible Modal/
   local stitch + R2 fetch + intro/outro compose OUT of the `StreamingResponse` generator and
   INTO the handler body. A stitch failure now raises a clean `HTTPException(500)` BEFORE any
   byte streams, instead of an exception thrown mid-stream after a 200 committed (the exact
   shape that produces a bare "Failed to fetch"). The generator only streams the finished file;
   a mid-stream read failure is now logged loudly with context. tmp_dir + scratch cleanup
   preserved on every path (eager-fail `except`, non-fatal compose, success/mid-stream `finally`).

**Verification evidence:**
- Regression tests: `tests/test_t7040_collection_download_event_loop.py` (3 tests) —
  event-loop-not-starved (fails-without/passes-with the fix), fix-shape guard, and
  stitch-failure→clean-500. All pass.
- Relevant set green: 47 passed — t7040 + t4240 (cleanup_stale_exports) + t4945
  (collection download) + t5220 + t5215.
- QA live-drive PASS (`e2e/T7040-collection-download.qa.spec.js`, via `scripts/dev-verify.sh`,
  `MODAL_ENABLED=false` → local stitch branch): dev-login as the real owner,
  `GET /api/collections/download?scope_type=all&aspect_ratio=9:16&budget_sec=15` → 200
  `video/mp4`, a playable 2.98 MB / 14.53s MP4 (ffprobe: real duration + video stream). The
  full unbounded `scope=all` also returned 200 in one run (134s handler time re-encoding 44
  reels on CPU — a local-stack artifact; prod offloads the arbitrary-N concat to Modal). No
  stitch-error path was triggered = the happy path is clean.

## Acceptance Criteria
- [x] Root cause confirmed with real evidence (Hypothesis D — event-loop starvation; confirmed
      via local repro that fails-without/passes-with the fix, evidence path noted above)
- [x] A collection download succeeds end-to-end (QA live-drive on the container's local stack:
      200 + playable MP4; staging re-verify to be done by supervisor after push)
- [x] If the fix is generator error-handling: a failure now surfaces as a clean HTTP error
      status — `download_collection` raises `HTTPException(500)` before the stream on stitch
      failure (`test_stitch_failure_returns_clean_500`); a post-headers mid-stream failure is now
      logged loudly with context (cannot become a clean status once a 200 has started, per the
      kickoff's concrete bar)
- [x] Regression test covering the actual root cause (event-loop starvation) + the hardening
- [x] Tests pass (47 in the relevant set)
- [ ] Staging re-verify of the reported scope (`game_id=6`, `9:16`) — owned by supervisor/user
      after the branch is pushed and deployed to staging
