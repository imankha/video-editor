# T7770: Execute the Playwright suite trim to a healthy runtime

**Status:** WIP
**Priority:** P1 (delivers the user's explicit runtime target)
**Impact:** 8
**Complexity:** 5
**Created:** 2026-08-25
**Updated:** 2026-08-25

## Problem

The user's full local Playwright run took 4.6 hours wall-clock. The user wants a full run
landing **somewhere in the 5-20 minute range** (clarified 2026-08-25 — not a strict 10-minute
ceiling; the original ask was an initial anchor, not a hard requirement), achieved by removing
redundant coverage (not brute-force deletion, not just adding Playwright parallelism/workers).
[T7760](T7760-playwright-redundancy-survey.md) produces the evidence for what's safe to cut;
this task executes that trim and verifies the result.

## Solution

**Blocked until T7760's survey document exists.** Once available:

1. Execute each consolidation/deletion recommendation from T7760's survey document — delete
   fully-redundant specs/test cases, merge specs that duplicate setup + partially-overlapping
   assertions, consolidate duplicated helpers (e.g. the 3+ copies of `ensureAddClipVisible`,
   the `openFramingChip`/`openFirstFramingDraft` variants) into single shared locations.
2. Also fold in the mechanical runtime wins already identified in the triage file's own "Slow
   Tests" section and its "Global finding" — a large share of the 144 failures ran to the
   5-minute local timeout ceiling rather than failing fast, meaning fixing (or fast-failing)
   those alone recovers hours of wall-clock. Cross-check: once T7730/T7740/T7750 land, re-time
   the previously-timeout-bound tests; most should now resolve in seconds rather than minutes,
   which may make some previously "slow" tests no longer trim candidates at all.
3. Re-run the full suite and measure wall-clock. If still over ~20 minutes after executing
   T7760's full recommendation set, return to T7760 for a second redundancy pass rather than
   reaching for parallelism/worker-count increases as a substitute (that's explicitly not
   what the user asked for) — Playwright worker parallelism can still be tuned as a
   complementary lever, but not in place of actually removing duplicate coverage. Landing
   anywhere in the 5-20 minute band is a successful outcome; there's no need to keep cutting
   once inside that range just to chase a lower number.

## Context

### Relevant Files (REQUIRED)
- Whatever T7760's survey document names as consolidation/deletion candidates — do not
  guess at file names here; read T7760's finished output first
- `src/frontend/playwright.config.js` — for verifying/tuning worker count as a secondary
  lever, not primary
- `docs/testing/playwright-triage-2026-08-25.md`'s "Slow Tests" section — raw duration data
  cross-reference

### Related Tasks
- **BLOCKED on [T7760](T7760-playwright-redundancy-survey.md)** — do not start implementation
  before T7760's survey document exists and has concrete recommendations
- Should land after [T7730](T7730-playwright-concrete-bugs.md) (concrete bugs) so the
  previously-timeout-bound tests can be re-timed accurately post-fix, per Solution step 2
- Sibling: [T7740](T7740-playwright-stale-test-cleanup.md), [T7750](T7750-playwright-env-scope-mismatch.md)

### Technical Notes
- The user was explicit that this is NOT satisfied by (a) deleting slow tests without a
  redundancy justification, or (b) throwing more Playwright workers/parallelism at the
  problem. Every deletion in this task must trace back to a specific T7760 recommendation.
- Full suite re-run to verify the runtime target is expensive (the baseline was 4.6h) — if
  the dev stack allows scoped re-runs of just the trimmed files' surrounding cluster first,
  prefer that before committing to a full-suite verification run.

## Implementation

### Steps
1. [ ] Confirm T7760's survey document exists and read its full recommendation list
2. [ ] Execute each deletion/consolidation recommendation
3. [ ] Consolidate duplicated shared helpers identified by T7760
4. [ ] Re-run the full suite, measure wall-clock
5. [ ] If over ~20 minutes, identify the remaining largest time sinks and either return to
       T7760 for a second pass or (secondary lever) tune worker parallelism
6. [ ] Document the final wall-clock and what was cut, for the record

## Acceptance Criteria

- [ ] Every deletion/consolidation traces to a specific T7760 recommendation (no
      unjustified brute-force deletion)
- [ ] Full `npx playwright test` run completes somewhere in the 5-20 minute range
- [ ] No loss of real coverage — every code path previously exercised by a deleted/merged
      test is still exercised by the consolidated survivor
- [ ] Tests pass; CI green
