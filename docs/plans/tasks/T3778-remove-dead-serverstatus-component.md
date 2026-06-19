# T3778: Remove Dead ServerStatus Component

**Status:** DONE
**Impact:** 1
**Complexity:** 1
**Created:** 2026-06-18
**Updated:** 2026-06-18

## Problem

`src/frontend/src/components/shared/ServerStatus.jsx` is dead code. It is exported from nowhere
and mounted nowhere — `components/shared/index.js:12` even carries the comment
`// ServerStatus removed - relying on operation-specific error handling instead`, but the file
itself was never deleted. It does an on-mount `GET /api/health` that never runs in the app.

Found during **T3770** (StrictMode page-load measurement): the kickoff assumed `/api/health` ×2
came from two live components (`ConnectionStatus` + `ServerStatus`). Measurement proved otherwise —
the sole on-mount health checker is `ConnectionStatus`; `ServerStatus` does not mount at all.

## Solution

Delete `src/frontend/src/components/shared/ServerStatus.jsx`. Confirm no imports remain (the only
references are the file itself and the explanatory comment in `index.js`). Optionally tidy the
stale comment in `index.js`.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/components/shared/ServerStatus.jsx` — the dead file to delete.
- `src/frontend/src/components/shared/index.js` — has the "ServerStatus removed" comment; verify no
  active export.

### Related Tasks
- Discovered during: T3770.

### Technical Notes
- Pure deletion; no behavior change. Run a build/lint to confirm nothing imports it.

## Implementation

### Steps
1. [ ] `grep` for `ServerStatus` imports across `src/frontend` to confirm zero live usages.
2. [ ] Delete the file; tidy the `index.js` comment if desired.
3. [ ] Build/lint check passes.

### Progress Log

**2026-06-18**: Created from T3770 measurement, which confirmed ServerStatus mounts nowhere.

## Acceptance Criteria

- [ ] `ServerStatus.jsx` deleted; no remaining imports.
- [ ] Frontend build/lint passes.
