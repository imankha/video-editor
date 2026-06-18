# T3770: Confirm/Eliminate StrictMode Duplicate Page-Load Fetches

**Status:** TODO
**Impact:** 3
**Complexity:** 2
**Created:** 2026-06-17
**Updated:** 2026-06-18

## Coordination (perf batch — HAR 2026-06-17)

Part of the 4-task perf batch. See
[perf-batch-har-2026-06-17.md](perf-batch-har-2026-06-17.md) for the full plan.

- **Branch:** `feature/perf-page-load` (shared with T3760; files are disjoint).
  Run this conversation **before** T3760 if sharing the branch, so the quick
  verdict commits first. A throwaway solo branch is fine too.
- **Conversation:** C3 — solo. **Verify against a production build before
  changing any code.** Expected outcome: a documented no-op verdict.
- **Stay out of:** `quests.py`, `clips.py`, and `FramingScreen`'s
  `getClipVideoConfig` — those belong to the other conversations. If a real fix is
  needed it lives in `App.jsx` / `projectDataStore.js` / `main.jsx`.

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

## Measurement & merit gate

**Quantity optimized:** requests per resource on page load. HAR (dev) shows
`/api/bootstrap` ×2, `/api/projects/46` ×3, `/api/health` ×2. Target in a prod build:
**1 each**.

**Most-direct measurement (the measurement IS the verdict here):**
Count requests per resource with Playwright `browser_network_requests` (or a HAR),
**before** = dev/StrictMode build, **after** = production build (`npm run build` +
preview). Two outcomes:

- **Prod build already shows 1 per resource** → StrictMode-only, harmless. Record the
  before (dev ×2/×3) and after (prod ×1) counts in the Progress Log and **close as a
  documented no-op** (like T2540's "HTTP/2 already active"). No code = no risk; the
  measurement is what justifies doing nothing.
- **Prod build still shows duplicates** → real wasted fetches. Add the in-flight
  promise dedup guard (T2500 pattern) and commit a **deterministic test**: fire the
  two mount paths and assert exactly one in-flight request per resource. Re-capture the
  prod-build counts as the after-number.

**Merit gate:** if the prod build is clean, the merit of the change is **zero** and the
risk of adding dedup guards is real — so the correct, merit-respecting outcome is the
no-op verdict, not a speculative guard. Only the measured persistence of duplicates in a
prod build justifies touching code.

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

- [ ] **Before/after request-per-resource counts captured** (dev vs prod build) and recorded in the Progress Log — the measurement that backs the verdict.
- [ ] Documented verdict: StrictMode-only (no-op) OR real duplicate fetch path found.
- [ ] If real: dedup guard added with a deterministic one-request-per-resource test; prod build shows exactly one request per resource on load.
