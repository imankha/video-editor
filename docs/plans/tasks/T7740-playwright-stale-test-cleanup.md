# T7740: Update or delete the stale/broken Playwright test bucket (~55 failures)

**Status:** STAGING
**Priority:** P2 (mechanical volume, no product-code risk, blocks a clean baseline)
**Impact:** 5
**Complexity:** 6
**Created:** 2026-08-25
**Updated:** 2026-08-25

## Problem

Of the 144 failures from the 2026-08-25 full Playwright run, the largest bucket (~55,
categorized "Stale/broken test" in `docs/testing/playwright-triage-2026-08-25.md`) are
assertions/selectors that predate a later shipped product change — they fail because the app
correctly changed, not because it's broken. Left as-is, these mask real signal in every future
run and inflate the 4.6h wall-clock the user wants cut to 10 minutes.

## Solution

Work through the "Stale/broken test" entries in `docs/testing/playwright-triage-2026-08-25.md`
(read the full "Failure Clusters" section — do not re-derive from the summary table, the
per-cluster writeups have the exact file:line and reasoning already). Do NOT duplicate that
analysis into this task file; treat the triage file as the source of truth and reference it
directly. For each cluster, either update the stale assertion/selector to match current
behavior, or delete the test case if a shipped change fully invalidated its premise (the
triage file calls this out explicitly per cluster, e.g. "delete this test case" for
`T6480-text-editor-contrast.qa.spec.js:102`, or "the entire test premise was invalidated" for
`T6630-text-add-remove-drag.qa.spec.js:318`).

**Known clusters (grep the triage file for these headings for full detail — this list is
navigation, not the source of truth):**
- `bug39-update-gate-aggressive.qa.spec.js` — dead API surface (Vite-dev version-check
  functions removed by the Tbug40p/Tbug41s refactor)
- `full-workflow.spec.js:227` — contradicts a deliberate T6830 product change
- `regression-tests.spec.js` shared helper `navigateToProjectFromHome` — stale selector +
  stale aspect-ratio assumption, one fix clears 4 tests
- `T4780-tutorial-quest-steps.spec.js` — stale generic tutorial-title string, stale `0.75x`
  default
- `T5070-blocking-update-gate.spec.js` — dead API surface (update-gate store rewrite)
- `T5130-sport-ball-playhead.qa.spec.js` — spec-robustness bug (needs a fresh unauthenticated
  browser context for public-share semantics)
- `T5190-intro-upload-consent.spec.js` + `T5215-intro-attachment.qa.spec.js` — T6660's
  "Athlete Intro Card" rename, one 2-line fix clears 11 tests
- `t5672-arrows-screenshot.spec.js`, `T5672-drafts-tiles-carousel.spec.js`,
  `t5672-screenshot-verify.spec.js`, `T5673-drawer-polish.qa.spec.js`,
  `T5673-my-reels-tiles.qa.spec.js`, `T5681-games-poster-grid.spec.js` — a cluster of
  T6810/T6800/T6890-era drift (carousel restructuring, pencil-icon rename replacing
  kebab-menu rename). **`t5672-carousel-chevrons-auto-badge.spec.js` was REMOVED from this
  list 2026-08-26** — its one listed issue (fragile `aspect_ratio` derivation via a live-
  account `find()`) was a duplicate classification; T7750 already fixed it (see T7750's
  Progress Log / merged PR #273). Do not re-touch this file unless a genuinely NEW issue
  turns up while working this cluster.
- `T5700-two-lanes.qa.spec.js:191` — stale `title` attribute assumption (T6400 invariant: My
  Athlete rows are unmarked by design)
- `T5930-update-gate-single-through-login.qa.spec.js:41` — dead API surface, same family as
  `T5070`/`bug39`
- `T6300-reel-tile-persistent-actions.qa.spec.js:149` — same pencil-icon rename as above
- `T6480-text-editor-contrast.qa.spec.js:102` — asserts a deliberately-removed element
- `T6630-text-add-remove-drag.qa.spec.js:318` — asserts a deliberately-removed global "Add
  Text" button

## Context

### Relevant Files (REQUIRED)
- `docs/testing/playwright-triage-2026-08-25.md` — READ FIRST, full per-cluster evidence
- The ~15-20 spec files named across the clusters above, under `src/frontend/e2e/`
- Shared e2e helpers referenced by multiple clusters (grep for
  `navigateToProjectFromHome`, and the pencil-icon/kebab-menu action helpers)

### Related Tasks
- Sibling tasks from the same triage: [T7730](T7730-playwright-concrete-bugs.md) (concrete
  product bugs), [T7750](T7750-playwright-env-scope-mismatch.md) (environment/fixture
  issues), [T7760](T7760-playwright-redundancy-survey.md) (coverage-overlap survey),
  [T7770](T7770-playwright-suite-trim.md) (suite trim, blocked on T7760)
- Test-file-only edits; file-disjoint from T7730's product-code changes except where a spec
  file also appears in T7730's bug list (e.g. `T6700`/`T6710` for the unscoped video
  locator, `T5225`/`T6610`/`T6630` for the textdiag harness fix) — verify against T7730's
  status before editing those specific files to avoid clobbering its fix

### Technical Notes
- This is the mechanical/high-volume bucket — no product-code risk, but ~55 entries across
  ~20 files. Consider splitting further by spec-file cluster if picked up as a single worker
  proves too large for one pass; the clusters above are natural split points.
- Do not touch the "Likely flaky/timing" or "Needs live-browser verification" entries in the
  triage file — those are explicitly NOT stale-test entries and need a different treatment
  (rerun/live-check first, not a blind assertion update).
- Part of the user's two-part ask: fix all real issues (this task addresses test-file rot,
  which isn't a "real issue" in product code but does block a clean baseline) + separately
  cut runtime via T7760/T7770.

## Implementation

### Steps
1. [ ] Work through each cluster listed above (or discovered while reading the full triage
       file's "Stale/broken test" entries), updating or deleting per the triage's verdict
2. [ ] Verify each fixed test passes against current master
3. [ ] Confirm no regression in tests that were already passing in the same spec files

## Acceptance Criteria

- [ ] All ~55 stale/broken-test entries from the triage file are resolved (updated or
      deleted, matching the triage's per-entry verdict)
- [ ] No product code changed by this task
- [ ] Tests pass; CI green
