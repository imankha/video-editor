# T7750: Resolve the Playwright environment/scope-mismatch bucket (~45 failures)

**Status:** WIP
**Priority:** P2 (mix of data hygiene, suite-glob scoping, and fragile-seed hardening)
**Impact:** 5
**Complexity:** 5
**Created:** 2026-08-25
**Updated:** 2026-08-25

## Problem

Of the 144 failures from the 2026-08-25 full Playwright run, ~45 are categorized "Environment
/scope mismatch" in `docs/testing/playwright-triage-2026-08-25.md` — tests that failed not
because of a product or test-code bug, but because a precondition wasn't met: a QA-only spec
run outside its intended harness, a `@staging-gate` test run locally, stale/missing real dev-
account fixture data, or a fragile `find()`-based synthetic-data seed that silently produces
`undefined`.

## Solution

Work through the "Environment/scope mismatch" entries in
`docs/testing/playwright-triage-2026-08-25.md` (full per-cluster evidence there — do not
duplicate into this file). Three shapes of fix apply, by entry:

1. **Suite-glob scoping** — exclude specs that were never meant for an unattended default run:
   `@staging-gate`-tagged specs (require a separate staging harness/manual precondition step),
   and the `tutorial-capture-*` trio (`tutorial-capture-framing.spec.js`,
   `-overlay.spec.js`, `-publish.spec.js` — explicitly documented as developer screen-
   recording scripts requiring hand-staged state, not assertions; `tutorial-capture-annotate`
   already passes and stays). Update whatever config/glob controls the default
   `npx playwright test` invocation to exclude these; keep them runnable via an explicit
   separate command.
2. **Data re-seeding / hardening** — re-run required seed steps for specs whose `beforeAll`
   assumes state not present in the current dev account (`bug27p-expired-annotations.spec.js`,
   `t4800-orphan-drafts.qa.spec.js`, `T5770-admin-weekly-usage.spec.js`,
   `T6190-project-open-fetches.qa.spec.js`, `T6400-inherit-last-clip-layer.qa.spec.js`,
   `T5780-framing-effective-duration.qa.spec.js` + `T5790-export-credit-cost-estimate.qa.spec.js`
   — extend `FIXTURE-CONTRACT.md`'s guarantee to cover an un-started draft specifically, per
   the triage's note that the current contract only promises "≥1 framed project"). Where a
   spec hardcodes a real-account project id that can rot (`T6620-defects.qa.spec.js`'s project
   50), make it probe for a suitable project instead.
3. **Fragile-seed hardening** — `t5672-carousel-chevrons-auto-badge.spec.js:146` derives a
   synthetic draft's `aspect_ratio` via `current.find(p => ...)` against the live account,
   which can silently yield `undefined`; set `aspect_ratio` explicitly on the synthetic
   objects instead. `T6510-preview-image-frame-choice.qa.spec.js` +
   `T6560-preview-image-never-cleared.qa.spec.js`'s shared draft-selection helper needs to
   verify an action button actually exists before selecting a candidate draft, skipping to
   the next if not.

## Context

### Relevant Files (REQUIRED)
- `docs/testing/playwright-triage-2026-08-25.md` — READ FIRST, full per-cluster evidence
- `src/frontend/playwright.config.js` (or wherever the default test glob/tag exclusion is
  configured) — for the `@staging-gate` / `tutorial-capture-*` exclusion
- `docs/testing/FIXTURE-CONTRACT.md` (or equivalent — grep for "FIXTURE-CONTRACT" to confirm
  exact path) — for extending the un-started-draft guarantee
- The specific spec files named above under `src/frontend/e2e/`

### Related Tasks
- Sibling tasks from the same triage: [T7730](T7730-playwright-concrete-bugs.md) (concrete
  product bugs), [T7740](T7740-playwright-stale-test-cleanup.md) (stale test cleanup),
  [T7760](T7760-playwright-redundancy-survey.md) (coverage-overlap survey),
  [T7770](T7770-playwright-suite-trim.md) (suite trim, blocked on T7760)
- File-disjoint from T7730/T7740 except possibly the `playwright.config.js` glob change,
  which no other sibling task touches — safe to own here

### Technical Notes
- Data re-seeding on the real dev account is data-adjacent but not destructive (adding
  missing fixture rows, not deleting) — narrate what was seeded in the commit/PR. The one
  destructive action (deleting the two stray leaked clips) belongs to T7730, not this task —
  do not duplicate it here.
- The `@staging-gate`/`tutorial-capture-*` exclusion directly serves the user's 10-minute
  runtime goal (removes specs that were never meant to run unattended) — but this task is
  about correctness (making the suite pass cleanly), the systematic redundancy-driven trim is
  T7760/T7770's job. Don't scope-creep this task into deleting coverage for redundancy
  reasons.

## Implementation

### Steps
1. [ ] Add `@staging-gate` + `tutorial-capture-*` (except `-annotate`) exclusion to the
       default suite glob/config
2. [ ] Re-seed missing fixture data for each environment-mismatch entry (stray-clip-adjacent
       specs excluded, see T7730)
3. [ ] Harden the fragile `find()`-based aspect_ratio seed in
       `t5672-carousel-chevrons-auto-badge.spec.js`
4. [ ] Harden the draft-selection helper shared by `T6510`/`T6560` to verify an action
       button exists before selecting a candidate
5. [ ] Extend `FIXTURE-CONTRACT.md`'s guarantee to cover an un-started draft where needed
6. [ ] Re-run the affected specs to confirm they pass with the corrected environment/seeds

## Acceptance Criteria

- [ ] `@staging-gate` and `tutorial-capture-*` (except `-annotate`) no longer run in the
      default `npx playwright test` invocation, but remain runnable explicitly
- [ ] All ~45 environment/scope-mismatch entries from the triage file are resolved (re-
      seeded, hardened, or excluded, matching the triage's per-entry verdict)
- [ ] No product code changed by this task
- [ ] Tests pass; CI green
