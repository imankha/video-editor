# T5400: Make the staging e2e suite a trustworthy pre-deploy gate

**Status:** TODO
**Impact:** 7
**Complexity:** 4
**Created:** 2026-07-18
**Follows:** T4934 (staging-compatible mode) + T5320 (fixtures + timeout) — this finishes the job.

## Problem

T4934 + T5320 made the Playwright suite *targetable* at staging (seam skip, fail-fast timeout,
seeded imankh fixture). But the 2026-07-18 derisk pass proved it is **still not a gate you can
trust** — the automated staging signal is split into a reliable subset and a flaky remainder, so
"is staging green?" can't be answered by a single run today:

- **`waitForLoadState('networkidle')` never settles against a deployed target** (CDN + analytics +
  any polling keep the network busy). Every workflow spec that waits on it (game-loading,
  full-workflow UI, annotate-game-clock, …) times out — a local-dev-only ready-signal that doesn't
  translate to a live CDN. This is the single biggest source of flake.
- **The purpose-built `derisk-staging-*.qa` specs are state-hardcoded:** they log in as
  `e2e@test.local` and look for a specific `Wonder Goal` draft / a public collection share that the
  account doesn't have, so they fail on missing fixture data rather than real behavior.
- Net: a real regression and an environment/data flake look identical, and the full run is ~1.8h.

## Reliable today (keep) vs flaky (fix)
- **Reliable:** frontend unit suite; `T5290-recap-mobile-redesign.spec.js` (4/4 on staging);
  `T4550-overlay-transform.qa.spec.js` (when the machine is warm); API-health/login smoke.
- **Flaky/broken on deployed target:** anything using `networkidle`; the `derisk-staging-*.qa`
  specs (state-hardcoded); data-workflow specs needing specific seeded content.

## Solution

1. **Kill `networkidle` on deployed runs.** Replace `waitForLoadState('networkidle')` with a
   deterministic ready-signal — `domcontentloaded` + an explicit locator for the screen's real
   "ready" element (a rendered card/control), or an app-emitted ready flag. Sweep every spec that
   uses it; it should never be the wait on a deployed target.
2. **Make `derisk-staging-*.qa` state-independent.** Point them at the seeded fixture account
   (`imankh@gmail.com` / profile `9fa7378c`, per `e2e/FIXTURE-CONTRACT.md`) and discover a suitable
   draft/collection dynamically (query `/api/projects` for a `has_working_video && !has_final_video`
   draft; skip-with-reason if the fixture guarantees it and it's absent — loud, not silent) instead
   of hardcoding `Wonder Goal` / `e2e@test.local`.
3. **Define a curated `@staging-gate` subset** (tag or a `testMatch` list) that is reliable and
   fast — the specs that actually give signal on the changed surfaces — and document running IT as
   the pre-deploy gate, separate from the full local suite. Re-time it; target well under ~15 min.
4. **First-login 500 retry** (staging PG stale-pool, documented) baked into the shared auth helper
   so it isn't re-implemented per spec.

## Relevant files
- `src/frontend/e2e/**/*.spec.js` — the `networkidle` sweep (grep `waitForLoadState`)
- `src/frontend/e2e/derisk-staging-export.qa.spec.js`, `derisk-staging-endcard-copylink.qa.spec.js`
  — de-hardcode the fixture
- `src/frontend/e2e/helpers/realAuth.js` — first-login retry
- `src/frontend/e2e/helpers/targetEnv.js` (T4934) — deployed-target detection + `@staging-gate` set
- `src/frontend/e2e/FIXTURE-CONTRACT.md` (T5320) — the seeded-account contract these rely on
- `src/frontend/playwright.config.js` — timeout + the gate project/tag

## Acceptance Criteria
- [ ] No deployed-target spec waits on `networkidle`; each uses a deterministic ready-signal
- [ ] `derisk-staging-*.qa` pass against the seeded fixture account (or skip-with-reason if the
      contract's data is genuinely absent) — no hardcoded account/draft
- [ ] A curated `@staging-gate` subset runs green against staging in one shot, well under ~15 min,
      and is documented as THE pre-deploy gate
- [ ] A real regression on a changed surface makes the gate fail (prove it fails on a seeded break)
- [ ] `screen-usability` emulation blind spot stays documented, not counted as a gate failure

## Context
### Related Tasks
- Finishes T4934 + T5320. Found by the 2026-07-18 staging derisk pass (the run that was supposed to
  BE the gate, and couldn't be trusted). Blocks nothing but is the tooling that makes every future
  derisk trustworthy — hence prioritized ahead of feature bugs.

### Classification hint
M-tier, frontend test-infra only. The substance is the `networkidle` sweep + de-hardcoding the
staging specs + curating the gate subset. No product code.
