# T1190: Session-to-Machine Pinning via Fly.io Replay Headers

**Status:** TODO
**Impact:** 8
**Complexity:** 5
**Created:** 2026-04-08
**Updated:** 2026-04-08

## Problem

With multiple Fly.io machines, any request can land on any machine. Since each machine has its own SQLite database and in-process WebSocket connections, this causes:

1. **Lost WebSocket progress** — export runs on machine A, WS client connects to machine B, all progress updates dropped (user sees 0% forever)
2. **Database version conflicts** — machine A writes v14, machine B has v10, sync middleware detects conflict and enters degraded state
3. **Stale reads** — user saves on machine A, next request hits machine B which has older data
4. **Database locks** — two machines writing to the same R2-synced SQLite concurrently

We hotfixed exports with `fly-force-instance-id` (the frontend captures the WS machine ID and pins the export POST to it), but this is a point fix. The general problem affects all stateful requests.

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

### Failure Modes

| Scenario | Behavior |
|----------|----------|
| Target machine suspended | Fly auto-starts it (auto_start_machines=true), replay succeeds |
| Target machine destroyed | Replay fails, middleware clears cookie, current machine handles request |
| New machine added | Gets new sessions only (existing sessions pinned elsewhere) |
| Machine overloaded | Fly.io soft_limit triggers new machine; new sessions go there |

## Context

### Relevant Files
- `src/backend/app/middleware/db_sync.py` — Request middleware, add replay logic here
- `src/backend/app/websocket.py` — Currently sends machineId on WS connect (can remove after this)
- `src/frontend/src/services/ExportWebSocketManager.js` — Currently stores machineId for pinning (can simplify after this)
- `src/frontend/src/containers/ExportButtonContainer.jsx` — Currently adds fly-force-instance-id header (can remove after this)
- `src/backend/fly.production.toml` — Machine config
- `src/backend/fly.staging.toml` — Machine config

### Related Tasks
- Supersedes: Export-specific machine pinning hotfix (commit 9138359)
- Related: T1020 (Fast R2 Sync) — sync conflicts worsen without session pinning
- Related: T420 (Session & Return Visits) — session management touches same middleware

### Technical Notes

- `fly-replay` is a **response** header — the server tells Fly's proxy to replay the request. This is transparent to the client (no frontend changes needed beyond removing the hotfix).
- `FLY_MACHINE_ID` is automatically set by Fly.io in every container.
- Cookie-based approach means WebSocket upgrades also get pinned (browsers send cookies on WS handshake).
- The per-export `fly-force-instance-id` approach is a **request** header set by the frontend. It works but requires frontend awareness of infrastructure. The `fly-replay` approach is entirely server-side.

## Implementation

### Steps
1. [ ] Add `fly-replay` middleware in `db_sync.py` (or separate middleware)
2. [ ] Set `fly_machine_id` cookie on first response
3. [ ] On mismatch: return `fly-replay: instance=<cookie_value>` header
4. [ ] Handle unavailable target (clear cookie, proceed locally)
5. [ ] Test with 2+ machines on staging
6. [ ] Remove export-specific pinning hack (websocket machineId message, frontend fly-force-instance-id header)
7. [ ] Verify WebSocket connections are pinned via cookie

## Acceptance Criteria

- [ ] All requests from a session hit the same machine
- [ ] WebSocket + export POST always land on the same machine
- [ ] No database version conflicts under normal operation
- [ ] Graceful fallback when pinned machine is unavailable
- [ ] Export-specific pinning code removed (clean up hotfix)
