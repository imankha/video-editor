# T7770: Execute the Playwright suite trim to a healthy runtime

**Status:** TODO (BLOCKED on T7760)
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
1. [x] Confirm T7760's survey document exists and read its full recommendation list
2. [x] Execute each deletion/consolidation recommendation (see Progress Log)
3. [x] Consolidate duplicated shared helpers identified by T7760 (annotateClips.js,
       framingDraft.js executed; the sprawling 8-9-file hygiene consolidations deferred — see log)
4. [ ] Re-run the full suite, measure wall-clock  ← **SUPERVISOR/HOST FOLLOW-UP** (no live
       e2e stack in the container; only static `--list` parse verification was possible here)
5. [ ] If over ~20 minutes, second redundancy pass or worker tuning  ← depends on step 4
6. [x] Document the final counts and what was cut (below)

## Acceptance Criteria

- [x] Every deletion/consolidation traces to a specific T7760 recommendation (no
      unjustified brute-force deletion)
- [ ] Full `npx playwright test` run completes somewhere in the 5-20 minute range
      ← **NOT VERIFIED IN-CONTAINER** — no backend/dev servers/live account; wall-clock is a
      supervisor/host follow-up. Only `npx playwright test --list` (static parse) was run here.
- [~] No loss of real coverage — every deletion traced to a survey strict-subset; merges kept
      the union of distinct assertions. Two small honest caveats flagged in the log (T5643
      tracking-off assertion; T6630 folded tests rewired to current UI mechanisms — Branch CI
      is the real verdict).
- [ ] Tests pass; CI green  ← Branch CI is the mandatory full-sweep verdict (not runnable here)

## Progress Log — 2026-08-26 (T7770 execution)

**Static verification only** (container has no live e2e stack, per every prior wave worker):
`npx playwright test --list` (parse, not execute) + eslint on every touched file. Wall-clock
runtime target is an explicit supervisor/host follow-up — **NOT verified here.**

**Default-run collection (via `--list`): BEFORE 514 tests / 125 files → AFTER 462 tests / 114
files** (−52 test invocations, −11 files net; totals include the mobile/tablet project matrix).
Suite parses cleanly (exit 0); eslint clean (0 errors) on all 28 touched/created files.

Executed candidates (all trace to the survey's ranked table / cluster sections):
- **Whole-spec deletions:** stream-no-401 (#2), T5180-qa-evidence (#5), faststart-probe (#22);
  tutorial-capture-annotate tagged `@tutorial-capture` (#1, now excluded from default run like
  its 3 siblings). Items #3/#4 (T5930, bug39) were ALREADY GONE (T7740) — only stale targetEnv
  entries cleaned.
- **Merges (union of assertions kept):** reedit-reel+rerank-reel → new
  shared-viewer-affordance-gating.spec.js (#7); T5780 folded into T5790 (#8); T6560 unique
  null/422+no-op folded into T6510 (#9); T5220 folded into T-egress-livedrive then deleted (#6).
- **Test-case cuts:** game-loading test2 (#10); T5215-e (#11) + T5215 b/ROUND2 folded into
  ROUND3 (#12) + T5215-a stale default-badge reconciled vs T6680; T4550 test2 (#13); T5643
  test3 (#14); T5644 evidence test (#15); T6730 test2 (#16, test1 kept — unique seek assertion);
  T-egress 5a/5b trimmed vs T7350 (#20); regression-tests 4 redundant @full trimmed (#21);
  t5672 "13 drafts" audit (#25) + t5672-arrows-screenshot & t5672-screenshot-verify deleted
  (assertions ported first); T5673-tiles stale reel-rename + uncommitted Move-walk trimmed.
- **Cluster C text consolidation (#17/#18/#19):** T6630-text-add-remove-drag folded into
  round7 (dead removed-UI paths dropped) then deleted; round4 invalidated G1/G2/G2b removed,
  unique SW/error-banner/no-reflow kept; T6610 REDUCED to its 3 unique micro-facets (touch-drag,
  keyboard-nudge, 44px-delete) — NOT deleted, because round7 doesn't cover them; T5225
  add/toggle/delete block removed (kept lever snap/free-park).
- **Helper consolidations:** annotateClips.js (5 annotate specs, T7540's hardened
  openAddClipForm canonical); framingDraft.js (Family-A regex, T4550/T4880/T5370).

Deliberately SKIPPED / deferred (with reasons):
- **#23 full-workflow retire — SKIPPED:** its API-CRUD block has bespoke SQLite write-lock
  retry isolation; folding into regression's serial export-heavy @full file reintroduces the
  contention it was written to avoid. Left intact (bias against coverage loss).
- **#24 T4110 retire — SKIPPED:** survey's own Low-medium confidence + conditional ("retire
  once T4120 trusted"); an all-`.soft()` investigation spec — not a safe unconditional cut.
- **T6190 Family-A helper fold — SKIPPED (survey premise wrong):** T6190 uses a deliberately
  different T7750 regex + no-navigate flow; folding would regress it. The claimed
  "bracket-regex bug" did not exist (all copies already correctly escaped).
- **Secondary-hygiene helper consolidations DEFERRED** (introFixtures 9-file, myReels 8-file,
  gamesTab 4-file, syncStatusShim 3-file + the Cluster-H T6010 conflict-pin merge): zero runtime
  benefit, span many KEPT survivor specs, and are unverifiable in-container structural refactors
  (CLAUDE.md refactor-safety: characterization tests before structural change). A follow-up task.

Coverage caveats to surface: (1) T5643 test3 removal drops the only *asserting* site for the
tracking-off half of the hint gate (same `&&` expr whose other term is fully pinned by T5610) —
small net loss per survey #14. (2) The three T6630 round7 folded tests + reduced T6610 were
rewired to current-UI mechanisms and are statically sound but unrun — Branch CI is the verdict.
