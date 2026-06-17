# T3770: Confirm/Eliminate StrictMode Duplicate Page-Load Fetches

**Status:** TODO
**Impact:** 3
**Complexity:** 2
**Created:** 2026-06-17
**Updated:** 2026-06-17

## Problem

`Downloads/localhost.har` (captured 2026-06-17) shows duplicate requests on page load:
- `GET /api/bootstrap` ×2
- `GET /api/projects/46` ×3
- `GET /api/health` ×2

The most likely cause is **React 18 StrictMode** double-invoking effects in the **dev** server (each mount effect runs twice). That is harmless and does **not** happen in production builds. But it could also be a real effect-dependency issue (e.g., `/api/projects/{id}` fetched from three different mount effects), which would be wasted requests on every prod load.

This is a verification follow-up to **T2500 (Deduplicate Page-Load Fetches, DONE)** — confirming no new duplicate path regressed after it.

## Solution

1. **Reproduce against a production build** (`npm run build` + preview) or with StrictMode temporarily disabled. If the duplicates vanish, it's StrictMode-only → close as a no-op, documented (the same way T2540 documented "HTTP/2 already active").
2. **If duplicates persist in the prod build**, trace the call sites for `/api/projects/{id}` and `/api/bootstrap`. Add module-level in-flight promise dedup guards (the same pattern T2500/T2510 used for the store fetches).

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/main.jsx` — `React.StrictMode` wrapper (the dev double-invoke source).
- `src/frontend/src/screens/FramingScreen.jsx` — note the existing `clipVideoConfigCacheRef` dedup for `playback-url` (~L378); check whether `/api/projects/{id}` has similar protection.
- `src/frontend/src/stores/projectDataStore.js` and `App.jsx` — likely `/api/projects/{id}` and `/api/bootstrap` call sites.
- `docs/plans/tasks/page-load-optimization/T2500-deduplicate-page-load-fetches.md` — prior art / pattern to reuse.

### Related Tasks
- Follow-up to: T2500, T2510 (page-load fetch dedup, DONE).

### Technical Notes
- `bootstrap ×2 + projects ×3 + health ×2` is a classic StrictMode signature (effects fire twice) combined with multiple mount effects. Strong prior that this is dev-only — verify before changing any code.

## Implementation

### Steps
1. [ ] Capture the same flow on a production build; count requests per resource.
2. [ ] If single requests in prod → document StrictMode-only verdict, close no-op.
3. [ ] If duplicates remain → trace call sites, add promise dedup guards, re-verify.

### Progress Log

**2026-06-17**: Created from HAR analysis. Duplicates seen in dev HAR; suspected StrictMode. Needs prod-build confirmation before any code change.

## Acceptance Criteria

- [ ] Documented verdict: StrictMode-only (no-op) OR real duplicate fetch path found.
- [ ] If real: dedup guard added; prod build shows exactly one request per resource on load.
