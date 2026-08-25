# T7760: Redundancy/coverage-overlap survey across all e2e/*.spec.js files

**Status:** TODO
**Priority:** P1 (prerequisite for the user's 10-minute runtime target, no code risk)
**Impact:** 7
**Complexity:** 6
**Created:** 2026-08-25
**Updated:** 2026-08-25

## Problem

The user ran the full local Playwright suite: 348 passed / 144 failed / 23 skipped / 34 did
not run, **4.6 hours wall-clock**. Alongside fixing the real failures (T7730/T7740/T7750), the
user wants the suite cut to a **10-minute max**, driven specifically by removing REDUNDANT
coverage — "no code paths should be checked twice" (user's own words). This is explicitly NOT
satisfied by deleting slow tests arbitrarily or adding more Playwright parallelism — it
requires actually identifying which specs/test cases exercise the same application code as
another spec/test case, then consolidating or removing the duplicate.

`docs/testing/playwright-triage-2026-08-25.md` triaged all 144 failures and listed slow tests
(its "Slow Tests" section, raw duration data), but explicitly did NOT do this survey — it
categorized failures and flagged slow tests, not coverage overlap. That survey has not been
done and is the prerequisite for [T7770](T7770-playwright-suite-trim.md)'s trim.

## Solution

Read-only analysis producing a written survey document (no code changes in this task). Survey
all 140+ files under `src/frontend/e2e/*.spec.js`. For each spec file (or logical group of
spec files touching the same screen/component), identify:
- What user-facing flow or code path does it exercise?
- Does any OTHER spec already cover that same path (fully or as a subset)?

Focus areas the triage file's own investigation already surfaced as prime candidates (don't
treat this as exhaustive — these are starting leads, not the full scope):

1. **Duplicated setup helpers across spec files** — the triage's cluster writeups already
   found several: `ensureAddClipVisible` exists separately in at least 3 files (see T7730's
   bug 5 discussion); `openFramingChip`/`openFirstFramingDraft`-style variants recur across
   several T57xx specs (`T5780`, `T5790`, `T6190`, others — grep for the pattern). Duplicated
   helpers are a strong signal of duplicated setup for the same underlying flow, even before
   examining what each spec asserts.
2. **Subset coverage** — specs whose assertions are a strict subset of a "bigger" spec's
   coverage of the same screen (e.g. a narrow single-criterion spec vs. a comprehensive
   `*-defects.qa.spec.js` or `full-workflow.spec.js`-style spec covering the same screen more
   thoroughly).
3. **`regression-tests.spec.js`'s Smoke/Full tagged tests vs. the many individual T-numbered
   spec files** — check whether the tagged smoke/full suite already re-covers what a numbered
   spec covers in more depth, or vice versa. This is a named, concrete comparison the user's
   directive implies should be checked directly.

Output: a written survey document (`docs/testing/playwright-redundancy-survey-2026-08-25.md`
or similar, dated) listing concrete consolidation/deletion candidates — for each candidate,
name the specs/tests involved, what code path they share, and a specific recommendation
(delete spec X entirely / delete test case Y within spec X / merge X and Y / consolidate
shared helper Z into one location). No vague "these seem similar" entries — the survey exists
to make T7770's trim decisions mechanical, not to hand off more open-ended judgment calls.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/e2e/*.spec.js` (140+ files) — the survey target; read broadly, this task is
  explore-heavy
- `docs/testing/playwright-triage-2026-08-25.md` — existing failure categorization + Slow
  Tests section (raw duration data, not yet analyzed for redundancy) — use its per-cluster
  findings as a head start on duplicated-helper detection, don't re-derive from scratch
- `src/frontend/e2e/regression-tests.spec.js` — the Smoke/Full tagged suite, compare directly
  against individual T-numbered specs

### Related Tasks
- Sibling tasks from the same triage: [T7730](T7730-playwright-concrete-bugs.md),
  [T7740](T7740-playwright-stale-test-cleanup.md),
  [T7750](T7750-playwright-env-scope-mismatch.md)
- **Blocks [T7770](T7770-playwright-suite-trim.md)** — the trim cannot execute safely until
  this survey identifies concrete, evidenced cuts
- Read-only, no file-write conflicts with T7730/T7740/T7750's code/test edits — safe to run
  fully in parallel with all three

### Technical Notes
- This is analysis output, not implementation — the deliverable is the survey document, not
  code changes. Given the scale (140+ files), consider whether this warrants a multi-agent
  fan-out (several agents each surveying a slice of the spec directory, one synthesis pass) —
  that's an implementation-strategy choice for whoever picks this up, not fixed by this task
  file.
- Don't silently under-cover: if time/budget forces sampling rather than a full 140-file read,
  say so explicitly in the survey doc's own methodology section (matching the triage file's
  own "Methodology" section pattern) rather than presenting partial coverage as complete.

## Implementation

### Steps
1. [ ] Inventory all `src/frontend/e2e/*.spec.js` files and group by screen/component/flow
2. [ ] For each duplicated-helper lead from the triage file, confirm whether the specs using
       it also duplicate the flow it sets up, or use it for genuinely different assertions
3. [ ] Compare `regression-tests.spec.js`'s Smoke/Full tagged tests against individual
       T-numbered specs covering the same screens
4. [ ] Identify subset-coverage candidates (narrow spec fully covered by a broader one)
5. [ ] Write the survey document with concrete, per-candidate recommendations

## Acceptance Criteria

- [ ] Survey document written covering all (or explicitly all-but-sampled, with methodology
      stated) `src/frontend/e2e/*.spec.js` files
- [ ] Every consolidation/deletion candidate names the specific specs/tests, the shared code
      path, and a concrete recommendation (not a vague similarity note)
- [ ] The `regression-tests.spec.js` Smoke/Full vs. individual-spec comparison is explicitly
      addressed
- [ ] No code changes made by this task
