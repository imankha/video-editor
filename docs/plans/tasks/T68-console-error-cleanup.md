# T68: Console Error Cleanup

**Status:** TODO
**Impact:** LOW
**Complexity:** LOW
**Created:** 2026-02-11

## Problem

Console shows errors and excessive warnings during normal operation:

1. **WebSocket connection error** - Extraction WebSocket connects to wrong port
2. **Warning spam** - DetectionMarkerLayer logs "missing fps" on every render

## Issues

### 1. WebSocket URL Points to Vite (Port 5173)

```
WebSocket connection to 'ws://localhost:5173/ws/extractions' failed:
WebSocket is closed before the connection is established.
```

The WebSocket should connect to the backend (port 8000), not Vite dev server (5173).

**File:** `src/frontend/src/screens/ProjectsScreen.jsx:166`

**Fix:** Use `API_BASE` or similar to construct WebSocket URL correctly.

### 2. DetectionMarkerLayer Warning Spam

```
[DetectionMarkerLayer] Region region-auto-0-0 missing fps - detection marker navigation may be inaccurate. Re-export framing to fix.
```

This warning logs 15+ times when opening a project - likely on every render or for every detection frame.

**File:** `src/frontend/src/modes/overlay/components/DetectionMarkerLayer.jsx:35`

**Fix:**
- Log once per region (use a ref or Set to track already-warned regions)
- Or move to a useEffect that only runs when regions change

## Relevant Files

- `src/frontend/src/screens/ProjectsScreen.jsx` - WebSocket setup
- `src/frontend/src/modes/overlay/components/DetectionMarkerLayer.jsx` - Warning spam
- `src/frontend/src/config.js` - API_BASE definition

## Acceptance Criteria

- [ ] WebSocket connects to correct backend port
- [ ] No connection errors in console during normal operation
- [ ] DetectionMarkerLayer warning logs once per region, not per render
- [ ] No functional regressions
