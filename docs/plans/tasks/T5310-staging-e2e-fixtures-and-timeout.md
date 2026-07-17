# T5310: Staging e2e is unusable — seed real fixtures + shorten deployed timeout

**Status:** TODO
**Impact:** 6
**Complexity:** 5
**Created:** 2026-07-17
**Updated:** 2026-07-17

## Problem

Confirmed by a live staging characterization run (2026-07-17, desktop `chromium` project, 43
non-seam specs / 112 test cases, run against `reel-ballers-staging.pages.dev` +
`reel-ballers-api-staging.fly.dev`). The original T4934 finding — "73 failed / 4.3h" — was
**NOT** caused by the `/api/test/*` seams (only 2 specs touch those; handled by T4934). The
dominant cause is **the staging e2e account has no seeded data**, so every real-workflow UI spec
hangs on data that never appears until the **5-minute per-test timeout**.

### Evidence (partial run, stopped at 39/112 once the pattern was conclusive)
- **14 passed / 20 failed; 10 of the 20 were 5.0m timeouts.**
- **Pass fast (no data/UI setup):** API-integration tests — Games list 203ms, Games CRUD 205ms,
  clips-by-project 87ms.
- **Time out at 5.0m (need seeded data in a specific app state):**
  `game-loading.spec.js › Load saved game into annotate mode`,
  `game-loading.spec.js › editorMode state changes on game load`,
  `keyframe-integrity.spec.js › all guards verified with a project in framing mode`,
  `full-workflow.spec.js › Project Manager loads / Export TSV round-trip / Edit clip rating /
  Edit clip name / Clip sidebar shows imported clips / Star rating visible`,
  `annotate-game-clock.spec.js › annotation banner shows soccer-notation time`. All require a
  real game + clips + (some) a framed project — absent on staging's `e2e@test.local`.

### Residual, NON-data failures to triage (not obviously timeout/data — look individually)
- `derisk-staging-export.qa.spec.js › staging export pipeline + publish (smoke + durability)`
  and `derisk-staging-endcard-copylink.qa.spec.js › copy-link 5x fast` — these are
  **staging-targeted** specs that STILL failed; either they need seeded data too or they found a
  real staging behavior gap. Determine which.
- `blob-url-recovery.spec.js › classifier module exists and exports classifyVideoError` — a
  module-load assertion that should not need data; smells like the "Failed to fetch dynamically
  imported module" class the T4934 task noted (broken browser context / build-artifact fetch on
  the deployed target), i.e. a possible real issue, not data.
- `collections.spec.js › no horizontal overflow at 360px` — a layout assertion; triage whether
  it's a real responsive regression on staging vs a data-empty render.

## Solution (two parts; part 1 is the unlock)

### 1. Seed real fixtures for the staging e2e account (the actual unlock)
Give the deployed-target test account a canonical fixture: a game + raw clips + at least one
framed project + one published reel, matching what the workflow specs load. Options (decide in
implementation):
- Reuse `scripts/copy_user_between_envs.py` to copy a known-good account (e.g. a trimmed
  imankh fixture) INTO the staging `e2e@test.local` (or a dedicated `e2e-fixtures@…`), OR
- A staging seed script that materializes the fixture via the real APIs, run once / idempotent,
  keyed on `APP_ENV=staging`. Guard hard against ever touching prod.
Specs then use `loginAsRealUser` against that seeded account (already staging-capable —
`dev-login` is gated on `APP_ENV != production`, so it works on staging). Document the fixture
contract (what data the account is guaranteed to have) so specs can rely on it.

### 2. Shorten the deployed-target per-test timeout (makes the suite a usable gate)
5 minutes per test turns a data/config miss into a 5-min hang; 40+ such specs = the 4.3h
runtime. Set a much shorter per-test timeout when `E2E_BASE_URL` points at a deployed target
(T4934 already added `E2E_TIMEOUT_MS`; wire a sane deployed default, e.g. 45-60s) so a genuinely
broken spec fails fast and the suite finishes in minutes. A real regression then reads as a
fast, specific failure — not indistinguishable from a data-less hang.

## Dependencies / sequencing
- **Builds on T4934** (seam tag/skip + `E2E_TIMEOUT_MS` + `targetEnv.js`). Merge T4934 first (or
  land this on top of it) — this task reuses its deployed-target detection + timeout knob.
- Together, T4934 + T5310 make the staging suite an actual pre-deploy derisk gate; neither alone
  does.

## Relevant files
- `scripts/copy_user_between_envs.py` — fixture copy path (missing user_segments = invisible in
  admin; see the copy-account memory)
- `src/frontend/e2e/helpers/realAuth.js` — `loginAsRealUser`/`dev-login` (already staging-capable)
- `src/frontend/e2e/helpers/targetEnv.js` (T4934) — deployed-target detection + `E2E_TIMEOUT_MS`
- `src/frontend/playwright.config.js` — per-target timeout wiring
- The timeout-listed specs above — verify they pass once the fixture exists
- `reference_staging_test_account`, `reference_copy_account_script` (memory) — staging account
  ids + copy mechanics

## Acceptance Criteria
- [ ] The staging e2e account is seeded (idempotently, prod-guarded) with a documented fixture
      (game + clips + framed project + published reel); fixture contract written down.
- [ ] The previously-timing-out workflow specs (game-loading, keyframe-integrity, full-workflow,
      annotate-game-clock) PASS against staging using that fixture (or fail with a real,
      specific assertion — not a data hang).
- [ ] Deployed-target per-test timeout is short enough that a full staging run finishes well
      under an hour; a broken spec fails in <~60s, not 5m.
- [ ] The residual non-data failures (derisk-staging-*.qa, blob-url dynamic-import, collections
      360px) are each triaged: real staging bug (file/fix) vs data (covered by the fixture) vs
      environment — stated explicitly, none left silently skipped.
- [ ] A clean full staging run's pass/fail reflects real app behavior; documented as the derisk
      gate procedure.

## Context
### Related Tasks
- Completes what T4934 started (seam-compat → data+timeout-compat). Found by the same 2026-07-17
  staging derisk pass.
- T5300 (T4120 durability) is a separate real bug found in the same pass.

### Classification hint
M/L-tier. Backend/scripts (fixture seed) + frontend test config + spec verification. The fixture
design (what data, how seeded idempotently, prod-guard) is the substance; the timeout is small.
