# T128: Frontend WebSocket Reconnection Resilience

**Status:** TODO
**Impact:** 5
**Complexity:** 3

## Problem

Fly.io's auto-stop has a known issue where WebSocket connections can be dropped when the machine suspends or stops. The frontend WebSocket managers (ExtractionWSManager, export progress WS) may fail to reconnect gracefully, showing errors to the user during expected cold-start scenarios.

Current error observed on staging:
```
WebSocket connection to 'wss://reel-ballers-api-staging.fly.dev/ws/extractions' failed
[ExtractionWSManager] WebSocket error: Event {isTrusted: true, type: 'error'...}
```

## Solution

Ensure frontend WebSocket managers handle disconnection gracefully with exponential backoff reconnection. Don't show error UI for transient disconnects that are expected during Fly.io machine wake-up.

## Context

### Current State
- WebSocket managers exist for extraction status and export progress
- When machine sleeps and WS drops, errors appear in console and potentially in UI
- No distinction between "machine is waking up" (transient) vs "real connection failure"

### Target State
- WebSocket managers silently reconnect with exponential backoff
- Brief disconnects during machine wake (~1-5s) are handled without user-visible errors
- Persistent failures (>30s) show a non-alarming "reconnecting..." indicator
- Successful reconnect fetches any missed state updates via REST fallback

### Relevant Files
- `src/frontend/src/services/ExtractionWebSocketManager.js` (or similar) — Extraction WS
- `src/frontend/src/services/ExportWebSocketManager.js` (or similar) — Export WS
- `src/frontend/src/components/` — Any components that display WS connection errors

### Related Tasks
- Depends on: T100 (Fly.io backend must be deployed to test)
- Related: T126 (suspend mode reduces but doesn't eliminate disconnects)

### Technical Notes
- Exponential backoff: 500ms → 1s → 2s → 4s → cap at 10s
- On reconnect, fetch current state via REST API to catch any missed WS events
- Don't log WS errors to console in production (or log at debug level)
- Consider: shared reconnection utility that both WS managers use

## Implementation

### Steps
1. [ ] Audit existing WebSocket managers for current reconnection behavior
2. [ ] Add exponential backoff reconnection logic
3. [ ] Add REST state refresh on successful reconnect
4. [ ] Suppress error UI during transient disconnects (< 10s)
5. [ ] Show subtle "reconnecting..." indicator for longer disconnects
6. [ ] Test: simulate machine sleep → verify reconnection works

### Logging Requirements
- Log reconnection attempts at debug level: `[WS] Reconnecting (attempt {n}, backoff {ms}ms)`
- Log successful reconnect: `[WS] Reconnected to {endpoint} after {n} attempts ({elapsed}s)`
- Log state refresh: `[WS] Fetching missed state via REST after reconnect`
- Log permanent failure (after max retries): `[WS] Connection to {endpoint} failed after {n} attempts, giving up`
- Suppress default browser WS error logging for transient disconnects

## Acceptance Criteria

- [ ] WebSocket reconnects automatically after machine wake
- [ ] No error UI shown for disconnects under 10 seconds
- [ ] Exponential backoff prevents connection spam
- [ ] State is consistent after reconnection (no missed events)
- [ ] Console is clean of WS error spam during expected disconnects
- [ ] Reconnection attempts and results are logged at appropriate levels
