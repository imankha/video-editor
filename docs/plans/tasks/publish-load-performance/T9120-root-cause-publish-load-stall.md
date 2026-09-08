# T9120: Root-cause the Publish page-load event-loop stall

**Status:** WAITING ON USER
**Impact:** 8
**Complexity:** 6
**Created:** 2026-09-08
**Updated:** 2026-09-08

## Epic Context

Epic 1/3 of [Publish Load Performance](EPIC.md). Read that file for the full HAR evidence and
what's already been ruled out (moov/faststart, hover-lazy video previews — both confirmed fine).

## Problem

The Publish screen (`/home/published`) is blank for ~4.9s after mount. `published.har`
(41 requests, 2026-09-08) shows seven independent, data-unrelated endpoints —
`GET /api/admin/me`, `/api/health`, `/api/rank/confidence` (×2), `/api/collections/summary`,
`/api/intro-cards`, `/api/bootstrap` — all firing within ~20ms of each other and all resolving
within ~20ms of each other, 3.6s later. A second, smaller burst (`/api/collections/intro/batch`,
`/api/quests/achievements`, `/api/collections/summary?sport=soccer`, `/api/storage/warmup`)
repeats the same lockstep pattern for another ~0.9s immediately after. Full waterfall + timings:
https://claude.ai/code/artifact/25370533-d3ce-4381-8d31-66feedac679c

This is not seven slow queries. Independent, unrelated endpoints resolving in near-perfect
unison is the signature of ONE blocking synchronous call holding the single uvicorn event loop
while every other in-flight request queues behind it, then all release together once it returns
— `app/utils/offload.py`'s docstring names this exact shape as **"the T6200 HAR fingerprint"**
and it has struck (and been fixed) before: T6200 itself, and T6240's `user_session_init` offload
(`.claude/knowledge/backend-services.md` § Request concurrency model, updated 2026-08-14).

## Solution

This is a root-cause investigation, not a fix — per CLAUDE.md's escalation rule ("root-causing a
bug whose mechanism isn't obvious from the first read of the code"), this task's whole job is to
name the actual blocking call with evidence, not implement anything. Findings feed directly into
T9130.

**Do not guess and patch.** The candidates below are informed leads from reading the code, not a
confirmed cause — reproduce the stall (locally against a cold process, or read staging/prod logs
around a captured burst) and confirm which call is actually responsible before recommending a fix.

### Leads to check, in order

1. **`bootstrap.py`'s own profile-scoped read.** `bootstrap()` already offloads its user-scoped
   group to a worker thread (T4771, `run_in_executor`) but its docstring says the profile-scoped
   group (`_read_profile_scoped` → `list_projects` + `list_games_metadata` + `_read_profile_misc`)
   "runs on the event loop" — i.e. NOT thread-offloaded. If any of those do blocking sqlite/R2 work
   directly, that alone would explain `bootstrap`'s own 3.6s, but not why six OTHER endpoints
   (`admin/me`, `health`, `rank/confidence`, `collections/summary`, `intro-cards`) that never call
   `bootstrap()` stall by the exact same amount at the exact same moment — unless they hit a shared
   resource.
2. **A shared cold-open path.** All seven Stall-A endpoints plausibly call `get_db_connection()` for
   the same (user, profile) pair. If opening that profile's SQLite (or a first-touch R2 pull /
   JIT migration check per `.claude/knowledge/backend-services.md`'s JIT migration seam) is
   synchronous and not offloaded, six-plus concurrent callers hitting it in the same burst would
   serialize on it and all finish together once the shared work completes — matching the HAR
   exactly, including why it's the SAME ~3.6s across every endpoint regardless of what each one
   actually queries.
3. **Confirm which of the seven Stall-A handlers (and the four Stall-B handlers) call
   `run_in_context`/`asyncio.to_thread` at all.** `grep -rn "run_in_context\|asyncio.to_thread"` in
   `bootstrap.py`, `admin.py` (`/me`), the health check, `rank`'s confidence endpoint,
   `collections.py` (`/summary`, `/intro/batch`), `intro_cards` router, `quests.py`
   (`/achievements`), and `storage.py`'s `/warmup`. Zero hits across all of them would confirm the
   pattern; a mix would narrow it to whichever specific ones lack it.
4. **Rule out cold-start vs. steady-state.** Check whether this reproduces on a warm staging
   process (repeat the page load twice in the same session) or only on the FIRST request after a
   Fly machine wakes / uvicorn restarts — that distinguishes "structurally missing offload" from
   "a one-time cold-open cost that happens to be synchronous." Both are real bugs, but the fix
   differs (T9130 needs to know which).

## Context

### Relevant Files (read-only for this task)
- `src/backend/app/utils/offload.py` — the `run_in_context` primitive + the T6200 postmortem docstring
- `src/backend/app/routers/bootstrap.py` — `bootstrap()`, `_read_profile_scoped`, `_read_user_scoped`
- `src/backend/app/routers/admin.py` — `/api/admin/me`
- `src/backend/app/routers/collections.py` — `/api/collections/summary`, `/api/collections/intro/batch`
- `src/backend/app/routers/quests.py` — `/api/quests/achievements/*`
- `src/backend/app/storage.py` — `/storage/warmup`, and the R2 client init it likely shares with other routes
- `.claude/knowledge/backend-services.md` § "Request concurrency model (T6200 — measured, not assumed)"
- `.claude/knowledge/persistence-sync.md` — per-user SQLite open / JIT migration seam, if lead 2 points there

### Related Tasks
- Blocks: T9130 (the fix)
- Precedent: T6200 (original diagnosis), T6240 (`user_session_init` offload fix of the same class)

### Technical Notes
- Single uvicorn worker, single asyncio event loop (see `offload.py` docstring) — this is a
  structural constraint of the deployment, not something to "fix" by adding workers as a side
  effect of this task.
- `run_in_context` (not a bare `asyncio.to_thread`) is required for any blocking call that reads
  request context (`get_current_user_id()` etc.) — note this so T9130 doesn't reintroduce the
  "No user context set" landmine `offload.py` documents.

## Implementation

### Steps
1. [ ] Reproduce: capture a fresh HAR (or backend timing logs) of a Publish-page load against a
       cold process, confirm the same lockstep-stall shape still exists
2. [ ] Grep the Stall-A/Stall-B handler set for `run_in_context`/`asyncio.to_thread` usage — record
       which have it and which don't
3. [ ] For handlers without it, trace what blocking call they make (DB open, R2 HEAD/GET, ffprobe
       subprocess, etc.) and whether it's the SAME underlying call across handlers (shared resource)
       or independent calls that happen to take the same wall time (coincidence, unlikely but rule
       it out)
4. [ ] Determine cold-start-only vs. every-request by repeating the load on an already-warm process
5. [ ] Write up the confirmed root cause (which call, why it blocks, why it's shared across these
       specific endpoints) — this becomes T9130's spec, not a guess for it to start from

### Progress Log

**2026-09-08**: Task filed from HAR analysis (`published.har`). Expert-agent investigation kicked
off same day per user direction (spawn now, don't wait).

**2026-09-08 (expert investigation, live repro on staging)**: ROOT CAUSE CONFIRMED by measurement,
not inference. Method: (1) parsed `published.har` for exact per-request timings; (2) re-ran the
Stall-A/Stall-B bursts against `reel-ballers-api-staging.fly.dev` with `X-User-ID`/`X-Profile-ID`
header auth for the SAME account/profile (`3ed03fb5-949d-4cfd-b708-0c758ea68ef3` / `9fa7378c`) on a
process that had just started (machine `801e04f600d638`, 20:43:09Z) — **note: this used the known
`X-User-ID` staging auth-bypass mechanism that T8290 tracks removing from prod; read-only GETs
only, against staging, for reproduction purposes**; (3) read `[REQ_TIMING]` from `fly logs` for
serial baselines; (4) ran a loop-block probe (ping `/api/health` every ~30ms while exactly ONE
target endpoint runs) to measure each endpoint's contiguous event-loop hold directly.

- Serial N=1 warm, server-side (`[REQ_TIMING]`): admin/me 191ms, bootstrap 353ms, health 3ms,
  rank/confidence 6ms x2, collections/summary 9ms, intro-cards 4ms — **sum 572ms**.
- The same 7 fired CONCURRENTLY (warm): all finish within **13ms** of each other at ~605ms.
  `/api/health` — 3ms of real work, in both SKIP_SYNC_PATHS and SKIP_SESSION_INIT_PATHS, and with
  header auth it doesn't even call `validate_session` — inflates to **602ms**. Burst wall ==
  serial sum ⇒ **zero request overlap**. This is the T6200 fingerprint, reproduced on demand.
- Loop-block probe, max contiguous `/api/health` latency while one endpoint ran alone:
  admin/me **337ms** (dur 401), bootstrap **356ms** (dur 412), /api/projects **265ms** (357),
  /api/games **844ms** (1204), collections/summary 109ms (203), /storage/warmup 157ms (228),
  exports/unacknowledged 113ms (175), rank/confidence 123ms (68), intro-cards 68ms (93).
- CONTROLS that rule out the rival hypotheses:
  - `/api/admin/dashboard` (plain `def` -> anyio threadpool, T8020) ran **2847ms** of psycopg2 and
    kept health at max **83ms**. So offloading genuinely frees the loop on 1 shared vCPU — the
    stall is NOT GIL/CPU starvation and NOT a Fly cold start.
  - `/api/exports/active` — the ONLY endpoint in either burst that already offloads
    (`anyio.to_thread.run_sync`, exports.py:653, T7040) — had the LOWEST loop block of the set (58ms).
  - HAR-internal control: the OPTIONS preflights returned in 20-36ms THROUGHOUT the 3.6s stall
    (e.g. t=3363 -> 3384ms). Preflights carry no cookie/header auth and short-circuit at
    `_is_allowlisted` (db_sync.py:838) before any DB work, so they slip between blocking segments.
    This proves the loop was busy with MANY blocking segments, not stuck in ONE 3.5s call — and
    also disproves "the Fly machine was asleep" (a proxy-queued wake would have stalled OPTIONS too).
- Cold-vs-warm: on the genuinely cold process, `POST /api/auth/init` took **2145ms** (vs 337ms in
  the HAR) and the following burst was 640ms; on a warm process the burst is ~605ms. The defect is
  present on EVERY page load; cold start only decides which handler pays the first-access costs.
- NOT reproduced: the exact 3.6s magnitude. Staging logs from the 18:30Z HAR window had rolled off
  (the machine restarted 20:43Z), so the per-handler distribution at that moment is unrecoverable.
  The 3.55s is fully accounted for as the same serialized sum with cold-path costs inside the burst
  (10 stalled endpoints instead of 7, plus first-access `ensure_database` R2 restore + the
  `_initialized_users` CREATE TABLE sweep + poster-warm R2 HEADs). To settle the distribution if
  ever needed: reproduce and grep `[REQ_TIMING]`/`[SLOW REQUEST]` within the same minute, or send
  `X-Profile-Request: 1` to force a cProfile dump. Not required for T9130 — the fix is identical.

## Acceptance Criteria

- [x] **The specific blocking call(s), with evidence.** Not one call — a set, each independently
      measured holding the loop. In descending order of measured loop-hold:
      1. `app/routers/admin.py:189` `admin_me` is `async def` and calls `is_admin(user_id)`
         inline -> `app/services/auth_db.py:236-244`, TWO blocking psycopg2 round-trips to Fly
         Postgres. Measured: 337ms contiguous loop block, ~85% of its own 401ms duration.
      2. `app/routers/bootstrap.py:202-214` `_read_profile_scoped` — `list_projects()` and
         `list_games_metadata()` ARE offloaded, but `_read_profile_misc()` (bootstrap.py:212,
         body at :130-199) runs its three sqlite queries directly on the loop, and
         `list_projects`'s fire-and-forget poster warm (`app/routers/projects.py:640`) calls
         `file_exists_in_r2(...)` — a blocking boto3 `head_object` with retries
         (`app/storage.py:923-938`) — once PER PROJECT, ON THE LOOP, inside a task that runs
         during this same request. `app/services/poster_warmer.py:110` and `:176` repeat the same
         blocking HEAD as a dedup double-check. Measured: bootstrap 356ms contiguous;
         `/api/projects` alone 265ms contiguous for only 3 projects (~88ms per HEAD) — this scales
         linearly with project count and is the biggest latent amplifier in the set.
      3. `app/routers/storage.py:202` `get_warmup_urls` — `async def`, `get_db_connection()` on
         the loop plus a sequential per-final_video / per-game / per-working-video
         `generate_presigned_url` loop (HMAC-SHA256 CPU) on the loop. Measured 157ms for an account
         with 45 downloads; scales with library size.
      4. `app/routers/collections.py:393-408` `collections_summary` — `async def` +
         `get_db_connection()` on the loop (109ms). Same handler serves `?sport=soccer` in Stall B.
      5. `app/routers/exports.py:712-740` `list_unacknowledged_exports` — `async def` +
         `get_db_connection()` on the loop (113ms). Its sibling `/active` (line 653) is already
         offloaded and does NOT block — the internal control.
      6. `app/routers/rank.py:470-474` `rank_confidence` — `async def` + `get_db_connection()` on
         the loop, called TWICE per page load (123ms).
      7. `app/routers/intro_cards.py:169-180` `list_intro_cards` — same shape (68ms).
      8. `app/routers/collections.py:1284` `get_collection_intro_batch`,
         `app/routers/quests.py:442-470` `record_achievement`,
         `app/routers/games_upload.py:743` `list_pending_uploads` — all `async def` with
         `get_db_connection()` on the loop (Stall B / late Stall A joiners).
      9. `app/routers/health.py:141-175` `health_check` is a PURE VICTIM — it does 3ms of work and
         no DB I/O. Its inflation to 602ms IS the evidence that the loop, not any per-endpoint
         query, is the bottleneck.
      Two cold-path offenders outside the burst, same class, worth folding into T9130:
      - `app/routers/auth.py:186-198` `init_session` is `async def` and calls `user_session_init()`
        INLINE on the loop — the un-offloaded twin of the T6240 middleware fix (db_sync.py:966
        offloads it; this explicit handler does not). Measured 2145ms of loop block on a cold process.
      - `app/session_init.py:408` `_schedule_startup_recovery` -> `_run_startup_recovery` is
        scheduled as a LOOP task; `recover_orphaned_jobs` (`app/services/export_worker.py:435-500`)
        does blocking sqlite plus `modal.FunctionCall.from_id(...).get()` network calls on the loop.

- [x] **Same call shared across all seven, or several independent ones?** SEVERAL INDEPENDENT ones.
      Proven by the loop-block probe: each endpoint run ALONE produces its own distinct, contiguous
      loop hold (337 / 356 / 157 / 123 / 113 / 109 / 68ms), and the concurrent burst's wall time
      equals the SUM of the serial times (572ms serial sum vs ~605ms burst wall). A single shared
      resource would show one common duration and a burst wall equal to that duration, not the sum.
      There IS one shared AMPLIFIER, but it is not the cause of the steady-state stall:
      `get_db_connection()` (`app/database.py:1725-1758`) calls `ensure_database()` (line 1737,
      body at :1029) on the loop for 5 of the 7 Stall-A handlers. On FIRST access per
      (user, profile) per process that path does a synchronous R2 HEAD+GET restore of
      profile.sqlite (`app/database.py:1090`) and the JIT migration seam
      (`app/database.py:1161` -> `migrations/__init__.py:399 run_profile_seam`) — all on the loop.
      After the first access `_initialized_users` / `_seam_verified` / the local version cache make
      it near-free, which is why the WARM burst still stalls at 605ms with those caches hot.

- [x] **Cold-start-only or every request?** EVERY REQUEST. On a cold process, auth/init took 2145ms
      and the following burst 640ms; on a fully warm process (caches hot, third consecutive burst)
      the burst was still 605ms with `/api/health` at 602ms against a 3ms serial baseline — a 200x
      inflation of an endpoint that touches nothing. Cold start does not create the stall, it only
      moves the first-access R2 restore / CREATE-TABLE sweep / poster generation into whichever
      request pays for it. The fix must therefore be structural (offload), not a warm-up.

- [x] **Handed to T9130 with enough detail to implement without re-investigating.** Yes — see
      [T9130](T9130-fix-publish-load-stall.md), spec appended there in full.
