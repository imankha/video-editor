# T6200: Concurrent same-session API requests appear to serialize (~1.4s each, all finishing together)

**Status:** TODO
**Impact:** 8
**Complexity:** 5
**Created:** 2026-07-28
**Updated:** 2026-07-28

## Problem

In the prod HAR captured for T6190 (`Downloads/app.reelballers2.com`, 2026-07-28), four
requests are issued by the browser within a 4ms window and every one of them takes ~1460ms,
all completing within 2ms of each other:

| start (ms) | duration | request |
|-----------|----------|---------|
| 3275 | 1461 | `GET /api/clips/projects/52/clips/55/playback-url` |
| 3277 | 1460 | `GET /api/health` |
| 3277 | 1460 | `GET /api/clips/projects/52/clips` |
| 3279 | 1458 | `GET /api/games` |

That signature — identical durations, simultaneous completion — is queueing, not four
independent latencies. Notably `/api/health` is in there: it should be near-instant and
touches no user data, yet it takes the same 1460ms as the others. A trivially cheap endpoint
paying the same cost as expensive ones is the strongest single piece of evidence that the
requests are waiting on a shared resource rather than doing work.

The user-visible consequence: `playback-url` gates video playback, and it cannot finish before
the other three do. First R2 video byte lands **2.7s after the click**.

**This is a hypothesis, not a diagnosis.** The HAR proves the requests complete together; it
does not prove *why*. Candidate causes, to be distinguished by measurement:

- Per-session / per-profile lock around the SQLite profile DB (each request opens the user's
  DB and blocks on a shared connection or file lock)
- Single worker / low concurrency on the Fly backend, so requests process one at a time
- Session-middleware work (`update_session`, R2 touch, profile resolution) serializing on
  every authenticated request
- Browser-side HTTP/2 connection or coalescing artifact (should be ruled out first — cheapest
  to check, and T2540 in the Page Load Optimization epic already covers HTTP/2 verification)

If the cause is a per-session lock or a single worker, it caps concurrency for **every**
authenticated screen in the app, not just project open — which is why this scores higher
impact than the redundant-fetch cleanup it was found alongside.

Secondary question surfaced by the same capture: `playback-url` takes 1.4s even in the best
case. If serialization is ruled out, that endpoint's own cost needs its own look.

## Solution

Measure first, fix second. Do not change concurrency settings speculatively.

1. **Reproduce with a controlled probe.** Fire N concurrent `/api/health` requests from one
   authenticated session and record start/end per request. If durations scale linearly with N,
   requests are serialized. Repeat unauthenticated (if a path exists) to separate
   session-middleware cost from transport.
2. **Rule out the client/transport layer.** Confirm HTTP/2 multiplexing is actually in effect
   at the Fly edge (see T2540) so this isn't a connection-limit artifact.
3. **Instrument the backend request path.** Add timing around session resolution, profile-DB
   open, and handler body for one request, so the wait is attributed to a specific stage rather
   than guessed at.
4. **Fix what the measurement points to**, and re-run the probe to prove the change.

Only after the cause is known should worker count, lock granularity, or connection pooling be
touched.

## Context

### Relevant Files (REQUIRED)
Starting points — the real file list depends on what step 3 attributes the wait to.
- `src/backend/app/main.py` — app setup, middleware stack, server config
- `src/backend/app/database.py` — profile DB connection opening (`ensure_database`, connection lifecycle)
- `src/backend/app/services/user_db.py` — per-user SQLite access
- `src/backend/app/routers/clips.py` — `playback-url` handler (also the 1.4s secondary question)
- `src/backend/app/routers/games.py` — `/api/games` handler
- Fly config for the backend app (worker/concurrency settings)

### Related Tasks
- **T6190** — removes three redundant requests from the same critical path. Independent fix;
  do T6190 first (cheap, certain), then measure here against a cleaner baseline.
- **T2540** (`tasks/page-load-optimization/T2540-verify-http2-fly-edge.md`) — HTTP/2 verification,
  which is step 2 of this task; reuse rather than duplicate.
- **T3420** — profile critical-path endpoint latency (375ms per-request baseline) — prior art on
  per-request session cost; check whether this is the same root cause resurfacing.

### Technical Notes
- The evidence is one HAR from one session. Confirm the pattern reproduces before investing in
  a fix — a single cold-start capture could produce a similar-looking artifact.
- Watch for the sampling trap: if the probe uses endpoints that each open the profile DB, a
  lock and a single worker look identical. `/api/health` vs. a data endpoint is the
  discriminator — health should not need the user's DB at all.
- Per the project's data-safety posture, do not "fix" a DB lock by widening concurrent write
  access to a user's SQLite file. Serialized *writes* are correct; serialized *reads* on a
  cheap endpoint are the bug.

## Implementation

### Steps
1. [x] Build a concurrent-request probe against staging (N=1,2,4,8 on `/api/health`) and record per-request timing — `scripts/concurrency_probe.py` + test seam `GET /api/test/loop-probe`
2. [x] Confirm/deny linear scaling; capture the result in the Progress Log either way — **CONFIRMED** (see Progress Log 2026-07-30)
3. [x] Verify HTTP/2 multiplexing at the Fly edge (T2540) — anon concurrent `/api/health` stays flat/independent (finishes staggered), so transport multiplexing is not the constraint; the serialization is server-side
4. [x] Instrument session resolution / profile-DB open / handler body; attribute the wait — the middleware already emits `[REQ_TIMING]` (auth/init/handler/sync/overhead + inflight); wait attributed to blocking work on the single event loop, chiefly `validate_session`
5. [ ] Fix the attributed cause — **AT DESIGN GATE** (Stage 2 / Architect), awaiting user approval before implementation
6. [ ] Re-run the probe and a fresh browser HAR to prove the improvement
7. [ ] Separately measure `playback-url`'s own cost once serialization is excluded (secondary; deferrable to a follow-up)

### Progress Log

**2026-07-28**: Filed from the T6190 HAR analysis. Four concurrent requests including a trivial
`/api/health` all took ~1460ms and completed within 2ms of each other. Cause not yet
established — this task is scoped to measure before fixing.

**2026-07-30 — HYPOTHESIS CONFIRMED (serialization is real; cold-start refuted as the primary cause).**
Measured, not guessed. Artifacts: `scripts/concurrency_probe.py` + non-prod test seam
`GET /api/test/loop-probe` (`app/routers/test_seams.py`).

*Root cause:* the request path runs **blocking I/O directly on the single asyncio event loop** of
the single-worker uvicorn process (`Dockerfile:23`, no `--workers`). The dominant offender is
`validate_session()` — a synchronous psycopg2 query — called on the loop for EVERY authenticated
request in `RequestContextMiddleware._dispatch_impl` (`db_sync.py:604`, not `await`ed / not
`to_thread`). `async def` data handlers also run blocking `sqlite3` (`cursor.execute/fetchall`) on
the loop (e.g. `list_games`). While the loop is blocked, uvicorn cannot flush ANY completed
response, so a concurrent burst serializes AND all responses drain together → identical durations +
simultaneous completion (the exact HAR fingerprint).

*Evidence:*

Local loop-probe (single-worker uvicorn, 200ms unit of work; block = blocking-on-loop, async =
`await asyncio.sleep`, thread = `to_thread`):

| N | block (per-req / finish-spread) | async | thread |
|---|--------------------------------|-------|--------|
| 1 | 227ms / 0.0ms | 206ms | 207ms |
| 2 | 426ms / 0.0ms | 210ms | 224ms |
| 4 | 876ms / 0.3ms | 212ms | 229ms |
| 8 | **1753ms / 1.4ms** | 232ms | 226ms |

`block` scales linearly and all N finish within ~1ms of each other (reproduces the HAR exactly);
`async`/`thread` stay flat — the loop is the bottleneck, and offloading fixes it.

Staging (warm, real machine), concurrent `/api/health`:

| N | anon (no session) | authenticated (real cookie) |
|---|-------------------|-----------------------------|
| 1 | 202ms | 358ms |
| 2 | 132ms | 357ms |
| 4 | 90ms | 653ms |
| 8 | **118ms (flat)** | **1271ms (finish-spread 26ms)** |

The ONLY per-request code difference between anon and authed `/api/health` is `validate_session` on
the loop. Anon stays flat under concurrency; authed scales to ~1271ms/N=8 with all requests
finishing together — on a WARM server, so this is steady-state serialization, not a resume artifact.
`/api/health` "paying" the full time does NOT mean it is expensive: it is cheap but stuck behind the
burst's serialized work, and all responses flush together.

*Cold-start tested and demoted to secondary:* staging single-request cold 712ms vs warm 105ms shows
resume-from-suspend is real (~600ms), but prod runs `min_machines_running = 1` (a machine stays
warm) and the warm authed probe reproduces the signature with no resume. Cold-start stacks on top
when a machine did suspend, but it is not the primary cause of the HAR.

*Named blocking stage:* the single asyncio event loop, blocked by synchronous DB/R2 calls on the
request path — chiefly `validate_session` (auth stage), plus blocking SQLite in `async def`
handlers, and `user_session_init` when `X-Profile-ID` is absent.

*Proposed direction (for the design gate — NOT implemented):* keep the single process (preserves the
machine-global per-user write lock `_USER_WRITE_LOCKS` + in-process caches that data safety depends
on) and get blocking request-path I/O off the loop — offload `validate_session` (and hot blocking
reads) via `asyncio.to_thread`/executor (psycopg2 + sqlite3 both release the GIL during I/O so they
genuinely overlap), optionally with a short-TTL in-process session cache to cut the constant.
**Reject naive `--workers N`:** on 1 shared vCPU / 1024MB it risks OOM AND, worse, makes
`_USER_WRITE_LOCKS` per-process instead of per-machine — two workers could write the same user's
`profile.sqlite` concurrently, the exact CAS/data-loss hazard that lock exists to prevent.
Alternatives (convert async handlers to sync `def` for the anyio pool; session caching; VM resize)
weighed in the design doc. Stopped here at the design gate per the task brief.

## Acceptance Criteria

- [ ] The serialization hypothesis is confirmed or refuted with reproducible measurements (not a single HAR)
- [ ] If confirmed: the blocking stage is named, with timing evidence attributing the wait to it
- [ ] If confirmed and fixed: N concurrent `/api/health` requests no longer scale linearly in duration
- [ ] `playback-url` latency on project open is measurably reduced, with a fresh HAR as evidence
- [ ] If refuted: findings written up here and the task closed as OBSOLETE rather than left open
- [ ] Backend tests pass
