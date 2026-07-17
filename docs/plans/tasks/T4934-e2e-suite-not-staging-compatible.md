# T4934: E2E Suite Has No Staging-Compatible Mode

**Status:** TODO
**Impact:** 6
**Complexity:** 5
**Created:** 2026-07-16

## Problem

Found running the full Playwright suite against staging (`E2E_BASE_URL`/`E2E_API_BASE`) as a
derisk pass before the 2026-07-16 prod deploy: **73 failed, 18 skipped, 29 passed** out of 141
tests, over 4.3 hours. The failure shape is not 73 independent bugs — it's a systemic
environment mismatch:

- Many specs call `/api/test/*` seams (e.g. `/api/test/sync-fault`) in setup/`beforeEach`. Those
  seams are intentionally dev/local-only (`storage.py` `_test_seams_enabled`) and are NOT mounted
  on staging — the call gets the staging SPA's HTML 404 page back instead of JSON
  (`SyntaxError: Unexpected token '<', "<!doctype "... is not valid JSON`), which then hangs
  whatever waits on it until the 5-minute Playwright timeout.
- This produced a near-contiguous wall of 5.0m timeouts from `full-workflow.spec.js` through
  most of the suite, while the handful of pure API-integration tests (games/projects/clips CRUD,
  no UI setup) passed cleanly — the signature of a shared setup helper failing, not scattered
  assertion bugs.
- `screen-usability.spec.js` (T4930's own mobile matrix) failures are its already-documented
  Playwright-emulation blind spot (iOS/Android chrome can't be fully emulated), not new.
- A few `Failed to fetch dynamically imported module` errors look like secondary fallout from
  browser contexts left in a broken state after the hung navigations above, not a standalone bug.

Net effect: **the suite currently can't be trusted as a staging derisk gate.** A real regression
and this systemic seam-gap look identical (both time out), so nothing actually got verified this
run, and the 4.3-hour runtime makes it impractical to use as a pre-deploy gate anyway.

## Solution

Two independent problems to solve, either or both depending on appetite:

1. **Make the suite staging-aware.** Either (a) add a staging-compatible substitute for the
   `/api/test/*` seams the suite depends on (a lightweight admin-gated endpoint that does the
   same job without the security profile of the local-only seams), or (b) tag every spec/test
   that depends on a `/api/test/*` seam and skip that tag when `E2E_BASE_URL` is set to a
   deployed target (`playwright.config.js` already has the `AUTOSTART`/`E2E_BASE_URL` split to
   hang this off of). (b) is cheaper but shrinks staging coverage to whatever's left; (a) is more
   work but keeps real coverage.
2. **Cut the runtime.** 4.3 hours for 141 tests (mostly via 5-minute timeouts on hung setup) is
   unusable as a derisk gate regardless of (1). Once (1) removes the seam-dependent hangs, re-time
   the suite — if it's still impractically long, look at `fullyParallel: false` / `workers: 1`
   (playwright.config.js) which forces the whole suite sequential; staging runs may tolerate more
   parallelism than local dev did (verify no shared-state test pollution first).

## Context

### Relevant Files
- `src/frontend/playwright.config.js` — `BASE_URL`/`API_BASE`/`AUTOSTART` env-based target
  switch already exists (lines ~30-48); this is the natural hook point for a staging tag/skip.
- `src/frontend/e2e/global-setup.js` — prints target info; would need a staging-mode note.
- `src/backend/app/storage.py` — `_test_seams_enabled` gates the `/api/test/*` routes; whatever
  they mount only in dev/local.
- Specs observed hanging on seam calls: `full-workflow.spec.js`, `game-loading.spec.js`,
  `keyframe-integrity.spec.js`, `regression-tests.spec.js`, `request-storm-regression.spec.js`,
  `sidebar-scrub-debug.spec.js`, `T4780-tutorial-quest-steps.spec.js`, `T5070-blocking-update-gate.spec.js`,
  `T4900-overlay-action-failure-visibility.spec.js`, `blob-url-recovery-T1360...` — likely not
  exhaustive; a scripted grep for `/api/test/` across `e2e/*.spec.js` will find the full set.
- Raw run log (this finding's evidence): reduced via `reduce_log`, not retained as a file — rerun
  against staging with `grep: "/api/test/"` to regenerate the specific failure list if needed.

### Related Tasks
- Follow-up from [T4930](T4930-mobile-viewport-usability-matrix.md) (mobile/viewport matrix) —
  same "File a task per failure the first [staging] run surfaces" spirit, but this is about the
  base suite's staging-compatibility, not T4930's mobile matrix specifically.

### Technical Notes
- Don't add a defensive fallback that silently no-ops when a seam 404s — that would hide real
  staging regressions behind a "test passed" green check. The fix must make the gap visible
  (explicit skip with a reason) or close it (real staging-safe seam), never paper over it.
- `reference_staging_test_account` (project memory) already documents this seam gap as known;
  this task is about actually closing it rather than re-discovering it on every derisk pass.

## Acceptance Criteria

- [ ] Every spec's dependency on `/api/test/*` is either replaced with a staging-safe path or
      explicitly tagged/skipped when running against a deployed `E2E_BASE_URL`, with a clear
      reason logged (not a silent skip).
- [ ] A full staging run's pass/fail/skip breakdown reflects real app behavior — no test times
      out purely because a seam 404'd.
- [ ] Runtime is practical enough to actually use as a pre-deploy gate (target: well under an
      hour; re-evaluate parallelism once seam-hangs are gone).
- [ ] `screen-usability.spec.js`'s known emulation blind spot stays documented, not "fixed" (it's
      not fixable within Playwright).
