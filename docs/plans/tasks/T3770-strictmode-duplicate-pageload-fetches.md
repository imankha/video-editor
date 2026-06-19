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

**2026-06-18 — MEASURED VERDICT (mixed: 2 no-ops + 1 real residual).**

Method: (1) parsed `Downloads/localhost.har` server-side for the dev baseline; (2) reproduced
the exact page-load flow live (Playwright + e2e auth-bypass, open a project → framing) on the
running dev server with `<React.StrictMode>` ON; (3) re-measured the same flow with StrictMode
temporarily removed from `main.jsx` (production-equivalent: React disables mount-effect
double-invoke in prod builds). `main.jsx` was reverted and the throwaway test project deleted;
working tree is clean.

| Resource | Dev HAR | Dev live (StrictMode ON) | Prod-equiv (StrictMode OFF) | Verdict |
|----------|--------:|-------------------------:|----------------------------:|---------|
| `GET /api/bootstrap`     | ×2 | ×2 | **×1** | **StrictMode-only → NO-OP** |
| `GET /api/health`        | ×2 | ×2 | **×1** | **StrictMode-only → NO-OP** |
| `GET /api/projects/{id}` | ×3 | ×3 | **×2** | **1 StrictMode dup collapsed; ×2 residual is REAL** |

Per-resource analysis:

- **`/api/bootstrap` — StrictMode-only (no-op).** Single call site `App.jsx:196` inside
  `initSession().then(...)` (an effect-driven path). ×2 in dev → ×1 with StrictMode off. No code.
- **`/api/health` — StrictMode-only (no-op).** Overturns the kickoff prior of "two distinct
  components." `ServerStatus.jsx` is **dead code** (`components/shared/index.js:12`: "ServerStatus
  removed") and is mounted nowhere. The sole on-mount health checker is `ConnectionStatus.jsx:46`
  (single `useEffect`). StrictMode doubled that one effect → ×2 dev → ×1 prod-equiv.
  (`ExportButtonContainer.jsx:560` is export-only, not page load.) No code.
- **`/api/projects/{id}` — ×3 → ×2; the residual ×2 is a REAL prod duplicate.** Decomposition
  (confirmed by HAR timing AND live): 1× `…?_t=<ms>` from `projectsStore.fetchProject` (L86,
  imperative via `selectProject` → fires once, even under StrictMode) + (dev) 2× bare
  `/api/projects/{id}` from `ProjectContext.jsx:28` `useEffect([projectId])` (StrictMode-doubled).
  With StrictMode off the bare fetch is ×1, so projects → **×2 in production**. This residual is
  genuine **redundant state**: `projectsStore.selectedProject` (fetched with `?_t`) and
  `ProjectContext.project` (bare) are two independent holders of the same project, each issuing its
  own fetch on project-open. Not a StrictMode artifact — present in prod on every project open.

Merit gate on the projects residual: the T2500/T2510 in-flight-promise dedup guard does **not**
apply cleanly — the two requests have different URLs (`?_t` cache-buster vs bare) and come from two
different modules/consumers, so a URL-keyed promise guard can't dedupe them. The correct fix is
architectural (have `ProjectContext` consume `projectsStore.selectedProject` instead of
re-fetching, or remove `ProjectContext` in favor of the store), which touches load-bearing context
code (`useProject()` consumers, `refresh()` semantics). For an impact-3 task, that refactor's
regression risk is disproportionate to eliminating one duplicate fetch of a fast endpoint on
project-open (not even page-load-home). **Recommendation: close bootstrap+health as documented
no-ops; spin the projects residual into a small dedicated follow-up task rather than a speculative
guard here.** Awaiting user decision before any code change.

## Acceptance Criteria

- [x] **Before/after request-per-resource counts captured** (dev vs prod build) and recorded in the Progress Log — the measurement that backs the verdict.
- [x] Documented verdict, per resource: bootstrap = StrictMode-only (no-op); health = StrictMode-only (no-op, single component — ServerStatus is dead code); projects = ×3→×2, **real residual duplicate** (two project-data holders).
- [ ] If real: dedup guard added with a deterministic one-request-per-resource test. **DEFERRED** — projects residual needs an architectural fix (ProjectContext→store consolidation), not the T2500 promise-guard pattern; recommended as a scoped follow-up. Awaiting user decision.
