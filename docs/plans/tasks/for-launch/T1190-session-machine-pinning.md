# T1190: Session & Machine Pinning via Fly.io Replay Headers

**Status:** TODO
**Impact:** 8
**Complexity:** 5
**Created:** 2026-04-08
**Updated:** 2026-04-28

## Interaction with T1510 (admin impersonation)

T1510 shipped first and calls `response.delete_cookie("fly_machine_id")` on
every impersonation start/stop. When T1190 lands, the design must ensure:

1. The `fly_machine_id` cookie is **always cleared** when a session swaps user
   context (impersonation start or stop). This is already wired in T1510.
2. The first request after an impersonation swap must be allowed to land on
   any machine and re-pin — the target user's DB may live on a different
   Fly machine than the admin's.

The hooks exist in `src/backend/app/routers/admin.py` (`_clear_machine_pin_cookie`,
lines 611-616). Do not remove them when implementing T1190.

## Interaction with T1195 (session durability)

T1195 shipped and persists sessions as individual R2 objects. This changes
the T1190 picture:

1. **Sessions already survive restarts.** `validate_session()` does cache →
   local SQLite → R2 GetObject on miss. A request landing on any machine can
   authenticate (~100ms R2 penalty on first hit, then cached). T1190 does NOT
   need to solve session loss — only data locality.
2. **The real cost of wrong-machine is data restore, not auth.** From staging
   logs, restoring user.sqlite takes ~250ms and profile.sqlite takes ~360ms.
   A cold request on the wrong machine pays ~600ms+ in R2 downloads before
   it can serve data. Machine pinning eliminates this.
3. **Session cleanup is already R2-aware.** `invalidate_session()`,
   `invalidate_user_sessions()`, and `cleanup_expired_sessions()` all delete
   from R2. T1190's single-session enforcement can call
   `invalidate_user_sessions()` directly — R2 cleanup is handled.
4. **`last_seen_at` already tracks activity.** Updated on every `/me` call
   and on login (`update_last_seen` in auth.py). T1190 can use this for
   inactivity expiry without adding new tracking.


## Problem

With multiple Fly.io machines, any request can land on any machine. Since each machine has its own SQLite database and in-process WebSocket connections, this causes:

1. **Lost WebSocket progress** — export runs on machine A, WS client connects to machine B, all progress updates dropped (user sees 0% forever)
2. **Database version conflicts** — machine A writes v14, machine B has v10, sync middleware detects conflict and enters degraded state
3. **Stale reads** — user saves on machine A, next request hits machine B which has older data
4. **Database locks** — two machines writing to the same R2-synced SQLite concurrently

We hotfixed exports with `fly-force-instance-id` (the frontend captures the WS machine ID and pins the export POST to it), but this is a point fix. The general problem affects all stateful requests.

## Current State (as of T1195)

### Infrastructure

Both staging and production run **single machines** with auto-stop/suspend:
- `fly.production.toml`: 1 CPU shared, 1024 MB, `min_machines_running = 1`
- `fly.staging.toml`: 1 CPU shared, 1024 MB, `min_machines_running = 0`
- Region: `lax` for both
- Concurrency: hard_limit=250, soft_limit=200

T1190 only matters when scaling beyond 1 machine. The soft_limit (200) is
the trigger — Fly spins up a second machine when concurrent requests exceed
this, and without pinning, requests split randomly between machines.

### Per-User Write Lock (machine-local only)

`db_sync.py` (lines 124-136) uses a per-user `asyncio.Lock` to serialize
mutations. **This lock is machine-local** — it prevents concurrent writes on
a single process but does nothing across machines. Without T1190, two
machines writing for the same user will both succeed locally and race on the
R2 upload, causing version conflicts.

### R2 Sync-After-Write

After every mutation, the middleware (db_sync.py lines 571-578) syncs both
profile.sqlite and user.sqlite to R2 via `asyncio.gather`. Without pinning:
- Machine A writes v14, uploads to R2
- Machine B (which had v13) writes v14 from stale base, uploads to R2
- Machine B's upload overwrites machine A's — data loss

### Data Restore on Cold Access

`user_db.py` (lines 97-173) restores user.sqlite on first access per machine.
`database.py` restores profile.sqlite similarly. Both use R2 HeadObject to
check version, then GetObject to download if newer. A 30-second cooldown
(`_r2_user_restore_cooldowns`) prevents retry storms on R2 failures.

### Existing Export Pinning Hack

| Component | File | Lines | What it does |
|-----------|------|-------|-------------|
| Backend WS machineId | `app/websocket.py` | 169-172 | Sends `FLY_MACHINE_ID` on WS connect |
| Frontend stores machineId | `ExportWebSocketManager.js` | 198-200 | Stores `this.machineId` from WS message |
| Frontend pins export POST | `ExportButtonContainer.jsx` | 656-657, 709-710, 762-769 | Adds `fly-force-instance-id` header |

This hack uses a **request** header (client tells Fly which machine). T1190
replaces it with a **response** header (server tells Fly to replay), which
is transparent to the client and covers all requests, not just exports.


## Solution

Implement session affinity using Fly.io's `fly-replay` response header so all requests from a user session route to the same machine.

### Design

**On first request (no machine cookie):**
1. Request lands on any machine via normal load balancing
2. Backend middleware reads `FLY_MACHINE_ID` from environment
3. Response includes `Set-Cookie: fly_machine_id=<machine_id>; Path=/; SameSite=Lax; Secure`

**On subsequent requests (has machine cookie):**
1. Backend middleware reads `fly_machine_id` cookie from request
2. If cookie value matches current `FLY_MACHINE_ID` → proceed normally
3. If cookie value differs → return response with `fly-replay: instance=<cookie_machine_id>` header
4. Fly.io proxy intercepts this and replays the request to the correct machine
5. If target machine is unavailable (crashed/suspended) → clear cookie, proceed on current machine, set new cookie

**WebSocket connections:**
- Same cookie-based routing applies — WS upgrade request carries cookies
- No more need for the export-specific `fly-force-instance-id` hack (can remove once this ships)

### Where to implement

The replay logic belongs in `db_sync.py` middleware (lines 279-441), early in
the request pipeline — before user data loading. Sequence:

1. Extract `fly_machine_id` cookie
2. If present and mismatched → `fly-replay` response (short-circuit, no DB work)
3. If absent → proceed normally, set cookie on response
4. If matched → proceed normally

This must run **before** the user's SQLite is loaded (line 414+) to avoid
paying the R2 restore cost on a request that will just be replayed anyway.

### Failure Modes

| Scenario | Behavior |
|----------|----------|
| Target machine suspended | Fly auto-starts it (auto_start_machines=true), replay succeeds |
| Target machine destroyed | Replay fails, middleware clears cookie, current machine handles request |
| New machine added | Gets new sessions only (existing sessions pinned elsewhere) |
| Machine overloaded | Fly.io soft_limit triggers new machine; new sessions go there |

### Detecting unavailable target

Fly.io returns a 503 when the replay target is unreachable. The middleware
should catch this scenario. Options:
- **Option A**: Set `fly-replay` with a `state` parameter; if Fly replays
  back to the originator (circuit-breaker), detect and handle locally.
- **Option B**: Use Fly's machine API to check machine state before replaying.
  Adds latency — probably not worth it.
- Investigate Fly.io docs for the exact replay failure behavior before
  choosing.

## Context

### Relevant Files
- `src/backend/app/middleware/db_sync.py` — Request middleware, add replay logic here (lines 279-441)
- `src/backend/app/services/auth_db.py` — `invalidate_user_sessions()` for single-session enforcement; session R2 cleanup already wired (T1195)
- `src/backend/app/websocket.py` — Currently sends machineId on WS connect (remove after this)
- `src/frontend/src/services/ExportWebSocketManager.js` — Currently stores machineId for pinning (remove after this)
- `src/frontend/src/containers/ExportButtonContainer.jsx` — Currently adds fly-force-instance-id header (remove after this)
- `src/backend/app/routers/admin.py` — `_clear_machine_pin_cookie` (lines 611-616, preserve)
- `src/backend/fly.production.toml` — Machine config
- `src/backend/fly.staging.toml` — Machine config

### Related Tasks
- Depends on: T1195 (Session Durability on Deploy) — ✅ DONE, sessions survive restarts
- Supersedes: Export-specific machine pinning hotfix (commit 9138359)
- Absorbs: T420 (Session & Return Visits) — session expiry and single-session enforcement are tightly coupled with machine pinning (stale sessions pointing at dead machines)
- Related: T1020 (Fast R2 Sync) — sync conflicts worsen without session pinning
- Superseded by: T1960 (Migrate Auth to Fly Postgres) — eliminates auth-related parts of this task, but data-locality pinning is still needed for per-user SQLite

### Technical Notes

- `fly-replay` is a **response** header — the server tells Fly's proxy to replay the request. This is transparent to the client (no frontend changes needed beyond removing the hotfix).
- `FLY_MACHINE_ID` is automatically set by Fly.io in every container.
- Cookie-based approach means WebSocket upgrades also get pinned (browsers send cookies on WS handshake).
- The per-export `fly-force-instance-id` approach is a **request** header set by the frontend. It works but requires frontend awareness of infrastructure. The `fly-replay` approach is entirely server-side.
- Even after T1960 (Postgres for auth), machine pinning is still valuable: per-user profile.sqlite and user.sqlite live on local disk, and restoring from R2 on every wrong-machine request adds ~600ms latency.

## Implementation

### Steps
1. [ ] Add `fly-replay` middleware in `db_sync.py` — early in pipeline, before user data loading
2. [ ] Set `fly_machine_id` cookie on first response
3. [ ] On mismatch: return `fly-replay: instance=<cookie_value>` header (short-circuit before DB load)
4. [ ] Handle unavailable target (clear cookie, proceed locally, set new cookie)
5. [ ] Add session TTL — expire sessions after inactivity using `last_seen_at` (absorbs T420)
6. [ ] Enforce single active session per user — new login calls `invalidate_user_sessions()` then `create_session()` (absorbs T420; R2 cleanup already handled by T1195)
7. [ ] Clean up stale session cookies pointing at dead/suspended machines
8. [ ] Test with 2+ machines on staging
9. [ ] Remove export-specific pinning hack: delete machineId from websocket.py (lines 169-172), ExportWebSocketManager.js (lines 198-200), ExportButtonContainer.jsx (lines 656-657, 709-710, 762-769)
10. [ ] Verify WebSocket connections are pinned via cookie

## Acceptance Criteria

- [ ] All requests from a session hit the same machine
- [ ] WebSocket + export POST always land on the same machine
- [ ] No database version conflicts under normal operation
- [ ] Graceful fallback when pinned machine is unavailable
- [ ] Export-specific pinning code removed (clean up hotfix)
- [ ] Sessions expire after inactivity period
- [ ] Only one active session per user at a time
