# Epic: Initial Load Time

**Status:** TODO
**Created:** 2026-06-02
**Priority:** P0

## Goal

Cut initial page load from ~7.8s to ~2-3s. The current load is a strictly sequential three-phase waterfall (auth/me 1.8s -> auth/init 2.2s -> 9 data endpoints 3.7s) with no overlap between phases. Consolidating into findings from two independent analyses.

## Evidence

**HAR capture** showing 7.8s total load time:

| Phase | Wall Clock | Duration | Gate | Root Cause |
|-------|-----------|----------|------|------------|
| 0: Static Assets | 0-100ms | 100ms | None | CF Pages edge cache -- fast |
| 1: auth/me | 100-1902ms | 1.8s | Must complete before anything | Fly.io cold start + Postgres session check |
| 2: auth/init + reactive | 1905-4130ms | 2.2s | Awaited by initSession() | Sequential R2 downloads (user.sqlite + profile.sqlite) |
| 3: Data Load | 4122-7811ms | 3.7s | Waits for Phase 2 | 9 endpoints all ~3.6s server wait -- thread pool contention |

Key observations:
- All 9 Phase 3 endpoints return within 20ms of each other (3625-3645ms) despite being completely different endpoints -- classic convoy/queuing signature
- 15 total API calls on page load with per-request auth validation and SQLite open/close overhead
- Warmup endpoint fires AFTER auth instead of before it, providing zero cold-start benefit
- Quest definitions endpoint makes a network round-trip for hardcoded static data

## Root Cause Analysis

### 1. Cold Fly.io Machine (1.8s)
First request (auth/me) wakes a suspended Fly.io machine. Boot uvicorn + init Postgres pool = 1768ms server wait. The /storage/warmup endpoint was designed to pre-warm the machine but fires in Phase 3 (after the cold start penalty is already paid).

### 2. Sequential R2 Downloads in auth/init (2.2s)
`user_session_init()` downloads user.sqlite then profile.sqlite from R2 sequentially. These are independent and could be parallelized. Additionally, `setSessionState(true)` fires BEFORE auth/init completes, triggering 4 reactive fetches without X-Profile-ID that each re-trigger session init in middleware.

### 3. Thread Pool Saturation in Phase 3 (3.7s)
9 concurrent endpoint handlers + presigned URL threads from /api/games compete for uvicorn's threadpool on a 1-CPU Fly.io VM. Plus SQLite WAL contention from 9 readers opening the same profile.sqlite simultaneously. A single /api/bootstrap endpoint eliminates this contention entirely.

### 4. _init_cache Race Condition
`_init_cache` in session_init.py is a plain dict without synchronization. Multiple concurrent Phase 2 requests bypass the cache and redundantly call ensure_user_database() + ensure_database(), wasting R2 bandwidth.

## Sequencing

Tasks are ordered by: quick wins first (unblock everything else), then the structural backend change (bootstrap), then optimizations that compound on top.

| # | ID | Task | Why This Order |
|---|----|------|----------------|
| 1 | T3310 | Pre-Auth Machine Warmup | Zero dependencies, biggest cold-start win. Unblocks faster auth/me for all subsequent tasks. |
| 2 | T3320 | Preconnect + Inline Warmup Script | Complements T3310 -- starts TCP+TLS during HTML parse, before React even loads. |
| 3 | T3330 | Embed Quest Definitions in Bundle | Eliminates a network round-trip for static data. Trivial, standalone. |
| 4 | T3340 | Thread-Safe Session Init Cache | Prevents redundant R2 downloads. Must land before bootstrap (T3370) to avoid amplifying race under higher concurrency. |
| 5 | T3350 | Parallelize R2 Downloads in auth/init | Cuts auth/init from ~2.2s to ~1.2s. Independent of frontend changes. |
| 6 | T3360 | Collapse Frontend Load Phases | Restructure initSession() so data fetches fire after auth/me, not after auth/init. Fixes premature setSessionState. |
| 7 | T3370 | Bootstrap Endpoint | The big structural fix: replace 9+ individual API calls with one batched response. Eliminates thread pool contention, CORS preflights, and per-request overhead. Subsumes pending-uploads validation, export recovery, and warmup. |
| 8 | T3380 | Lazy Presigned URLs for Games | Decouple presigned URL generation from /api/games (and bootstrap). Pre-warm in background or lazy-load on navigation. |
| 9 | T3390 | Reduce Auth Retry Config | Shorten retry delay and count for auth/me specifically. Risk reduction after T3310 makes cold starts rare. |
| 10 | T3400 | Defer Stripe JS to Payment Flow | Frees bandwidth on the critical path. Load Stripe SDK on first payment interaction, not on page load. |

## Shared Context

### Key architectural facts
- **Frontend auth flow:** sessionInit.js manages `_currentUserId` and `_currentProfileId`. The fetch interceptor (sessionInit.js:65-136) adds X-User-ID and X-Profile-ID headers to all API requests.
- **Backend middleware:** db_sync.py:500-511 checks for X-Profile-ID header. If missing, falls back to calling `user_session_init()` which downloads SQLite DBs from R2.
- **Existing page-load epic (T2500-T2540):** Already fixed duplicate fetches, store dedup guards, export recovery parallelization, and missing indexes. This epic addresses the remaining structural issues.
- **Gesture-based persistence:** All load-time requests are read-only, so no persistence concerns.
- **Thread pool:** uvicorn on a 1-CPU Fly.io VM. Default thread pool gets saturated by 9+ concurrent sync handlers.
- **Presigned URL cache:** `_PRESIGNED_URL_CACHE` in storage.py is a TTLCache with 3.5h TTL. Cold cache means every game hash triggers a 200-300ms R2 call.

### Files affected

| File | T3310 | T3320 | T3330 | T3340 | T3350 | T3360 | T3370 | T3380 | T3390 | T3400 |
|------|-------|-------|-------|-------|-------|-------|-------|-------|-------|-------|
| sessionInit.js | X | | | | | **PRI** | | | X | |
| App.jsx | | | X | | | **PRI** | X | | | X |
| index.html | | **PRI** | | | | | | | | |
| cacheWarming.js | X | | | | | | | | | |
| session_init.py | | | | **PRI** | **PRI** | | X | | | |
| storage.py | X | | | | | | X | **PRI** | | |
| bootstrap.py (new) | | | | | | | **PRI** | X | | |
| games.py | | | | | | | X | **PRI** | | |
| quests.py | | | X | | | | X | | | |

## Completion Criteria

- [ ] Cold-start page load under 3s (HAR capture)
- [ ] Warm page load under 2s (HAR capture)
- [ ] Single /api/bootstrap call replaces 9+ individual data fetch calls
- [ ] auth/me fires against a pre-warmed Fly.io machine (warmup fires before auth)
- [ ] No sequential R2 downloads in auth/init
- [ ] Quest definitions served from frontend bundle, not API
- [ ] No thread pool convoy effect (Phase 3 endpoints don't all return within 20ms of each other)
- [ ] Stripe JS loads only when user opens payment flow
