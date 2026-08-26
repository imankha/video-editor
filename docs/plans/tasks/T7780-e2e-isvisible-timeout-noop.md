# T7780: `isVisible({ timeout })` guards don't actually wait, silently defeating e2e navigation helpers

**Status:** TODO
**Priority:** P2 (pre-existing e2e-infra bug, causes silent test failures, not a product bug)
**Impact:** 6
**Complexity:** 3
**Created:** 2026-08-26
**Updated:** 2026-08-26

## Problem

Root-caused during T7770's post-merge verification (2026-08-26): three `regression-tests.spec.js`
`@smoke` tests ("Framing: video first frame loads", "Framing: crop window is stable", and a
related failure) were failing/timing out even after T7740 already fixed their originally-
diagnosed cause (a stale selector in the shared `navigateToProjectFromHome` helper).

The real, deeper bug: Playwright's `locator.isVisible({ timeout })` **ignores the `timeout`
option entirely** — it's an immediate, synchronous-style check, not a wait. Every guard shaped
like `if (await X.isVisible({ timeout: N }).catch(() => false)) { await X.click(); }` in this
codebase's e2e helpers silently returns `false` if the element hasn't rendered in the first
few milliseconds after a navigation, skips the click with NO error, and the real failure only
surfaces much later as a downstream assertion timeout with a confusing, unrelated error message
— exactly what happened here (the `mode-framing` testid assertion timed out 30s later, with the
actual cause — a skipped click three steps earlier — invisible in the test output).

Confirmed via Playwright trace inspection: in `navigateToProjectFromHome`
(`regression-tests.spec.js` ~line 654), all three `isVisible({ timeout })` guards resolved in
under 15ms total (not the requested 2000/3000/5000ms), well before the page had actually
rendered the project card / clip row, so the clicks were silently skipped and the function
returned having done nothing.

This is a **systemic pattern, not a one-off**: 39 occurrences of `isVisible({ timeout` exist in
`regression-tests.spec.js` alone (grep count at investigation time) — every one is a candidate
for the same silent-skip failure mode.

## Solution

Replace the `isVisible({ timeout }).catch(() => false)` guard-and-skip pattern with
`locator.waitFor({ state: 'visible', timeout })` (which DOES actually wait) followed by a real
click — letting the helper throw at the actual missing-element step instead of silently
deferring failure to whatever assertion happens to run later. This surfaces the real failure
point immediately with an accurate error, per the project's no-silent-fallback rule (a missing
element is real state the test should fail loudly on, not paper over).

**Start with the 3 confirmed sites** in `navigateToProjectFromHome`
(`regression-tests.spec.js` ~lines 664, 674, 683) since those are proven root causes with trace
evidence. Then audit the other ~36 occurrences in the same file (and grep the rest of
`src/frontend/e2e/` for the same pattern in other files) — not all of them are necessarily bugs
(some may be legitimately optional/conditional UI states where "not visible" is a valid,
expected branch), so each needs a quick read to confirm intent before converting.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/e2e/regression-tests.spec.js` — `navigateToProjectFromHome` (~line 654), the 3
  confirmed sites at ~664/674/683, plus ~36 other `isVisible({ timeout` occurrences to audit
- `src/frontend/e2e/*.spec.js` and `src/frontend/e2e/helpers/*.js` — grep for the same pattern
  repo-wide; this helper shape likely got copy-pasted into other spec files too

### Related Tasks
- Surfaced by an expert-agent root-cause investigation during
  [T7770](T7770-playwright-suite-trim.md)'s post-merge live verification — confirmed via
  `git diff` that T7770 did NOT introduce this (zero application-source changes, and the
  specific lines in question predate T7770 entirely, git-blamed to 2026-02/2026-04). Filed
  separately rather than fixed inline because the full scope (39+ sites, needs per-site intent
  review) is out of a redundancy-trim task's bounds.
- Distinct from [Cause B / T7790](T7790-e2e-clip-save-race.md) (a separate, unrelated timing
  bug in the clip-save path) — both were found investigating the same 3 failing tests, but
  have independent root causes and independent fixes.

### Technical Notes
- This is a real, confirmed bug (Playwright trace timings prove the `timeout` option has no
  effect on `isVisible()`), not a hypothesis — see the investigation's trace evidence:
  `isVisible` calls with `timeout:2000/3000/5000` all resolved in under 15ms and returned
  `false`, while the actual elements were confirmed present in a DOM snapshot taken later.
- Converting to `waitFor` will make some currently-silently-passing tests start failing loudly
  where they were previously masking a real navigation problem — that's the intended, correct
  outcome (visible failure > silent wrong-branch), but expect some tests to newly surface
  issues that were always there, undetected.

## Acceptance Criteria

- [ ] The 3 confirmed sites in `navigateToProjectFromHome` converted to `waitFor` + click
- [ ] All other `isVisible({ timeout` occurrences in `regression-tests.spec.js` audited;
      converted where the intent was "wait for this to appear," left alone where "check current
      state, branch either way" is actually correct
- [ ] Same audit done for the pattern elsewhere in `src/frontend/e2e/` if found
- [ ] The 3 originally-failing tests (or their consolidated survivors post-T7770) pass
- [ ] Tests pass; CI green
