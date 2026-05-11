# T1190 Kickoff Prompt

Copy everything below the line into a fresh Claude Code session.

---

Implement T1190: Session & Machine Pinning via Fly.io Replay Headers

## Epic Context

This is task 1 of 4 in the **Session Scaling** epic (`docs/plans/tasks/session-scaling/EPIC.md`). It is the foundation -- all subsequent tasks (T2250 Write-Back R2 Sync, T40 Single Active Session Handoff, T2260 Data Loss Detection) assume one machine per user. Must ship first.

## Problem

With multiple Fly.io machines, any request can land on any machine. Since each machine has its own SQLite database and in-process WebSocket connections, this causes:

1. **Lost WebSocket progress** -- export runs on machine A, WS client connects to machine B, progress updates dropped (user sees 0% forever)
2. **Database version conflicts** -- machine A writes v14, machine B has v10, sync middleware detects conflict
3. **Stale reads** -- user saves on machine A, next request hits machine B with older data
4. **Database locks** -- two machines writing to same R2-synced SQLite concurrently

Currently only exports are pinned via a frontend hack (`fly-force-instance-id` request header). T1190 replaces this with server-side `fly-replay` response headers that pin ALL requests transparently.

## Solution

Cookie-based session affinity using Fly.io's `fly-replay` response header:

**First request (no cookie):** Request lands on any machine. Backend sets `Set-Cookie: fly_machine_id=<FLY_MACHINE_ID>`.

**Subsequent requests (has cookie):** Middleware reads cookie. If it matches current machine, proceed. If it differs, return `fly-replay: instance=<cookie_value>` header -- Fly's proxy replays the request to the correct machine. If target machine is dead, clear cookie and proceed locally.

**WebSocket:** Same cookie routing applies (browsers send cookies on WS handshake).

## Implementation Steps

1. Add `fly-replay` middleware in `db_sync.py` -- early in pipeline, before user data loading
2. Set `fly_machine_id` cookie on first response
3. On mismatch: return `fly-replay: instance=<cookie_value>` header (short-circuit before DB load)
4. Handle unavailable target (clear cookie, proceed locally, set new cookie)
5. Add session TTL -- expire sessions after inactivity using `last_seen_at` (absorbs T420)
6. Enforce single active session per user -- new login calls `invalidate_user_sessions()` then `create_session()` (absorbs T420; R2 cleanup already handled by T1195)
7. Clean up stale session cookies pointing at dead/suspended machines
8. Test with 2+ machines on staging
9. Remove export-specific pinning hack: delete machineId from websocket.py, ExportWebSocketManager.js, ExportButtonContainer.jsx
10. Verify WebSocket connections are pinned via cookie

## Acceptance Criteria

- All requests from a session hit the same machine
- WebSocket + export POST always land on the same machine
- No database version conflicts under normal operation
- Graceful fallback when pinned machine is unavailable
- Export-specific pinning code removed (clean up hotfix)
- Sessions expire after inactivity period
- Only one active session per user at a time

## Key Interactions

### T1510 (Admin Impersonation) -- Already Shipped

`src/backend/app/routers/admin.py` lines 611-616 has a stub `_clear_machine_pin_cookie()` that deletes the `fly_machine_id` cookie on impersonation start/stop. **Do not remove this.** When T1190 ships, the first request after an impersonation swap must be allowed to land on any machine and re-pin (the target user's DB may live on a different machine).

```python
def _clear_machine_pin_cookie(response: Response) -> None:
    """T1190 hook: clear fly_machine_id so the next request re-routes to the
    correct Fly machine for whichever user we are now acting as."""
    response.delete_cookie("fly_machine_id", path="/")
```

### T1195 (Session Durability) -- Already Shipped

Sessions are persisted as individual R2 objects. `validate_session()` does cache -> local SQLite -> R2 GetObject on miss. A request landing on any machine can authenticate (~100ms R2 penalty on first hit, then cached). T1190 does NOT need to solve session loss -- only data locality.

The real cost of wrong-machine is data restore: restoring user.sqlite takes ~250ms and profile.sqlite ~360ms. A cold request on the wrong machine pays ~600ms+ in R2 downloads. Machine pinning eliminates this.

Session cleanup is already R2-aware. `invalidate_session()`, `invalidate_user_sessions()`, and `cleanup_expired_sessions()` all delete from R2. T1190's single-session enforcement can call `invalidate_user_sessions()` directly.

## Current Codebase State

### Middleware: `src/backend/app/middleware/db_sync.py` (698 lines)

The replay logic belongs in `RequestContextMiddleware._dispatch_impl()` (line 355), early in the request pipeline -- before user data loading.

Current flow in `_dispatch_impl()`:
1. Lines 363-368: Session cookie auth -- `request.cookies.get("rb_session")` then `validate_session(session_id)`
2. Lines 372-378: Fallback `X-User-ID` header (non-production only)
3. Lines 380-399: No user + not allowlisted = 401
4. Lines 418-427: Profile ID resolution
5. Line 441: `async with _maybe_write_lock(...)` then delegates to `_sync_aware_flow()`

**Where to insert replay logic:** Before line 363 (before session auth). Sequence:
1. Extract `fly_machine_id` cookie
2. If present and mismatched -> return `fly-replay` response (short-circuit, no DB work)
3. If absent -> proceed normally, set cookie on response
4. If matched -> proceed normally

Key paths that skip sync (from class attributes):
- `SKIP_SYNC_PATHS`: `/api/auth`, `/api/health`, `/api/admin`, etc.
- `AUTH_ALLOWLIST_PREFIXES`: paths that proceed without user context

**Per-user write lock** (lines 123-136): Machine-local `asyncio.Lock` per user_id. Serializes writes within one process but does nothing across machines. T1190's pinning prevents cross-machine writes for the same user.

**R2 sync-after-write** (lines 573-580): After every mutation, middleware syncs both profile.sqlite and user.sqlite to R2 via `asyncio.gather`. Without pinning, two machines can race on this upload.

### Auth: `src/backend/app/services/auth_db.py` (1123 lines)

Key functions for T1190:

```python
def create_session(user_id: str, ttl_days: int = 30) -> str:
    # Creates session in SQLite, caches in memory, persists to R2
    # Returns session_id (secrets.token_urlsafe(32))

def validate_session(session_id: str) -> Optional[dict]:
    # Returns {user_id, email, impersonator_user_id?, ...} or None
    # Chain: in-memory cache -> SQLite -> R2 GetObject

def invalidate_session(session_id: str) -> None:
    # Deletes from SQLite, cache, and R2

def invalidate_user_sessions(user_id: str) -> None:
    # Deletes ALL sessions for a user (SQLite + cache + R2)

def cleanup_expired_sessions() -> int:
    # Deletes expired sessions (SQLite + R2)

def update_last_seen(user_id: str) -> None:
    # Updates last_seen_at in users table (called on every /me and on login)
```

Sessions table schema: `session_id TEXT PRIMARY KEY`, `user_id TEXT NOT NULL`, `expires_at TEXT NOT NULL`, `created_at TEXT DEFAULT`, plus T1510 impersonation fields. **No `machine_id` column exists** -- the cookie handles machine affinity outside the session model.

### Export Pinning Hack (to remove)

**Backend WS** -- `src/backend/app/websocket.py` lines 169-172:
```python
fly_machine_id = os.getenv("FLY_MACHINE_ID", "")
if fly_machine_id:
    try:
        await websocket.send_json({"type": "connected", "machineId": fly_machine_id})
    except Exception:
        pass
```

**Frontend WS** -- `src/frontend/src/services/ExportWebSocketManager.js` lines 198-200:
```javascript
if (message.type === 'connected' && message.machineId) {
    this.machineId = message.machineId;
    console.log(`[ExportWSManager] Pinned to machine ${message.machineId}`);
    return;
}
```

**Frontend export POST** -- `src/frontend/src/containers/ExportButtonContainer.jsx`:
- Lines 674-683: Single clip export adds `fly-force-instance-id` header
- Lines 729-735: Overlay export adds `fly-force-instance-id` header

Both use: `const machineId = exportWebSocketManager.getMachineId()` then `{ 'fly-force-instance-id': machineId }`.

### Data Restore on Cold Access

`src/backend/app/services/user_db.py` lines 94-174 (`ensure_user_database()`): On first access per machine, checks R2 for newer version, downloads if needed. 30-second cooldown prevents retry storms.

`src/backend/app/database.py` lines 480-535 (inside `ensure_database()`): Same pattern for profile.sqlite. Both use version-based sync with R2 HeadObject then GetObject.

### Fly.io Config

**Production** (`src/backend/fly.production.toml`):
- 1 shared CPU, 1024 MB, `min_machines_running = 1`
- `auto_stop_machines = "suspend"`, `auto_start_machines = true`
- Concurrency: hard_limit=250, soft_limit=200
- Region: lax

**Staging** (`src/backend/fly.staging.toml`):
- Same specs but `min_machines_running = 0` (can fully suspend)

T1190 only matters when scaling beyond 1 machine. The soft_limit (200) is the trigger -- Fly spins up a second machine when concurrent requests exceed this.

## Failure Modes

| Scenario | Behavior |
|----------|----------|
| Target machine suspended | Fly auto-starts it (auto_start_machines=true), replay succeeds |
| Target machine destroyed | Replay fails, middleware clears cookie, current machine handles request |
| New machine added | Gets new sessions only (existing sessions pinned elsewhere) |
| Machine overloaded | Fly.io soft_limit triggers new machine; new sessions go there |

**Detecting unavailable target:** Fly.io returns a 503 when the replay target is unreachable. Investigate Fly.io docs for exact replay failure behavior before choosing between:
- Option A: Set `fly-replay` with a `state` parameter; if Fly replays back to originator (circuit-breaker), detect and handle locally
- Option B: Use Fly's machine API to check machine state before replaying (adds latency)

## Coding Rules

- **No silent fallbacks for internal data.** If something is missing, log a warning, don't silently default.
- **No defensive fixes for internal bugs.** Fix root causes, don't add workarounds.
- **Persistence is gesture-based, never reactive.** Every DB write must trace to a user gesture. No `useEffect` persistence.
- **Backend pattern:** Router -> Service -> Repository. HTTP concerns in routers only.
- **After editing Python files, always verify:** `cd src/backend && .venv/Scripts/python.exe -c "from app.main import app"`
- **Redirect test output to files:** `pytest ... 2>&1 > /tmp/test-output.log; echo "exit: $?"`
- **Use `reduce_log` for any log file** -- never ingest raw logs into context.

## Test Approach

Backend-only tests. Key scenarios:
- Cookie set on first response when `FLY_MACHINE_ID` is set
- Replay header returned when cookie mismatches current machine
- No replay when cookie matches
- Cookie cleared and re-set when target machine unavailable
- Session expiry after inactivity
- Single active session enforcement (new login invalidates old sessions)
- Impersonation clears machine pin cookie (existing T1510 behavior preserved)
- Paths in `SKIP_SYNC_PATHS` and `AUTH_ALLOWLIST_PREFIXES` still work correctly with replay logic

Run backend tests: `cd src/backend && .venv/Scripts/python.exe run_tests.py`
Run specific: `cd src/backend && pytest tests/test_<file>.py -v`

## Files to Change

| File | Change |
|------|--------|
| `src/backend/app/middleware/db_sync.py` | Add fly-replay middleware logic early in `_dispatch_impl()` |
| `src/backend/app/services/auth_db.py` | Session TTL enforcement, possibly single-session on login |
| `src/backend/app/routers/auth.py` | Call `invalidate_user_sessions()` before `create_session()` on login |
| `src/backend/app/routers/admin.py` | Preserve existing `_clear_machine_pin_cookie()` -- no changes needed |
| `src/backend/app/websocket.py` | Remove machineId sending (lines 169-172) |
| `src/frontend/src/services/ExportWebSocketManager.js` | Remove machineId storage + `getMachineId()` |
| `src/frontend/src/containers/ExportButtonContainer.jsx` | Remove `fly-force-instance-id` header usage |
| `src/backend/tests/test_session_pinning.py` | New test file for replay middleware |

## Classification

```
**Stack Layers:** Backend + Frontend (cleanup only)
**Files Affected:** ~8 files
**LOC Estimate:** ~150 lines (mostly backend middleware + test)
**Test Scope:** Backend

| Agent | Include? | Justification |
|-------|----------|---------------|
| Code Expert | Yes | Cross-layer, 8 files, need to verify exact line numbers before editing |
| Architect | Yes | New middleware pattern, session lifecycle changes, failure mode design |
| Tester | Yes | New behavior (replay, session expiry, single-session enforcement) |
| Reviewer | Yes | State management + persistence changes, cross-layer, 8 files |
```

Start with Stage 0 (classification is above), then Stage 1 (branch + Code Expert audit).
