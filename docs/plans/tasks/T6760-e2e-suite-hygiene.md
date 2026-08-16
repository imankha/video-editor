# T6760: E2E suite hygiene — stop rediscovering the same rot every sweep

**Status:** DONE — deployed 2026-08-16 prod.
**Impact:** 5
**Complexity:** 3
**Created:** 2026-08-11
**Updated:** 2026-08-11

## Problem

The 2026-08-11 full-sweep derisk pass (`docs/testing/derisk-plan-2026-08-11.md`, supervisor session)
ran the full e2e suite (536 tests) against master and got 342 pass / 125 fail. Every failure was
root-caused and NONE was a product regression — but the exercise took real supervisor time to
decompose, and this is not the first sweep to hit the same noise. The failure list
(`C:\tmp\failed-spec-files.txt`, 57 files, copied into this task's Context section below) breaks
into three recurring, previously-uncatalogued classes:

1. **Real-account specs that hang for the full 5-minute timeout** when the driving account's game
   storage has expired/drifted (e.g. the T5700/T5725/T5215/T6400 clusters) — the spec has no
   precondition check, so a stale fixture reads as "the feature is broken" instead of "the fixture
   needs repair," and burns 5 minutes doing it.
2. **Specs that require a precursor QA-harness step** to pass at all (bug27p's expired-game flip,
   the `tutorial-capture-*.spec.js` trio) — they fail by design outside their intended invocation,
   but nothing in the suite or its output says so, so every sweep re-discovers "these always fail"
   from scratch.
3. **Per-task QA/evidence specs that rotted after their target UI was superseded** — round-N
   evidence specs (`T5215-round4/5/6`, `T6630-round3/5/6-evidence`, `T6630-T6590-round2-evidence`)
   pinned to UI states later tasks intentionally changed, plus one-off debug specs
   (`sidebar-scrub-debug.spec.js`) that were never meant to be regression guards.

None of this is a code defect — it's e2e suite maintenance debt. Filing so the next sweep doesn't
have to re-triage the same 57 files from zero.

## Solution

Three independent cleanups, doable in any order:

(a) **Fast-fail guard for real-account specs.** Real-account specs (T5700/T5725/T5215/T6400 class)
    assert `storage_status === 'active'` (or the equivalent per-game check) in a shared `beforeAll`/
    setup helper instead of discovering staleness through a 5-minute per-test timeout. A stale
    fixture should fail in seconds with a clear "account data needs repair" message, not look like
    125 broken features.
(b) **Explicit skip guard for harness-dependent specs.** Apply the bug27p pattern (assert loudly,
    don't silently pass) everywhere a spec needs a precursor step it can't perform itself — e.g.
    `test.skip(condition, 'requires <precursor>; see <doc>')` — so a failed run reads as "this needs
    its harness step first," not "investigate from scratch."
(c) **Prune or archive superseded round-N evidence specs.** These were QA artifacts for since-merged
    tasks (T5215, T6630, T6590), not regression guards — either delete them (their acceptance
    criteria are covered by the current live specs for those features) or move them to a
    non-collected `e2e/archive/` location so `npx playwright test` stops picking them up.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/e2e/` — the whole directory; this task audits its contents, doesn't redesign it.
- `src/frontend/e2e/helpers/qa.js` — existing evidence helpers, no change expected.
- Full failed-spec list from the 2026-08-11 sweep (`C:\tmp\failed-spec-files.txt`, 57 files):
  ```
  e2e/T4110-reedit-reel-persistence.spec.js
  e2e/T4550-overlay-transform.qa.spec.js
  e2e/T4780-tutorial-quest-steps.spec.js
  e2e/T4850-move-reels.spec.js
  e2e/T5070-blocking-update-gate.spec.js
  e2e/T5130-sport-ball-playhead.qa.spec.js
  e2e/T5190-intro-upload-consent.spec.js
  e2e/T5215-intro-attachment.qa.spec.js
  e2e/T5215-round4.qa.spec.js
  e2e/T5215-round5.qa.spec.js
  e2e/T5215-round6.qa.spec.js
  e2e/T5225-text-lever-drag.qa.spec.js
  e2e/T5673-drawer-polish.qa.spec.js
  e2e/T5673-my-reels-tiles.qa.spec.js
  e2e/T5674-overlap-overflow.qa.spec.js
  e2e/T5676-aspect-stage-alignment.qa.spec.js
  e2e/T5700-team-layer-interactive.qa.spec.js
  e2e/T5700-two-lanes.qa.spec.js
  e2e/T5725-teammates-team-only.qa.spec.js
  e2e/T5770-admin-weekly-usage.spec.js
  e2e/T5870-sync-failed-retry-no-refresh.spec.js
  e2e/T5900-reel-preview-overflow.qa.spec.js
  e2e/T5910-tile-hover-actions-pointer.qa.spec.js
  e2e/T5930-update-gate-single-through-login.qa.spec.js
  e2e/T6010-T6020-failed-alarm-and-lifecycle-marker.spec.js
  e2e/T6300-reel-tile-persistent-actions.qa.spec.js
  e2e/T6320-my-reels-playhead.qa.spec.js
  e2e/T6400-inherit-last-clip-layer.qa.spec.js
  e2e/T6480-text-editor-contrast.qa.spec.js
  e2e/T6510-preview-image-frame-choice.qa.spec.js
  e2e/T6560-preview-image-never-cleared.qa.spec.js
  e2e/T6600-modal-z-order.qa.spec.js
  e2e/T6610-text-body-drag.qa.spec.js
  e2e/T6620-defects.qa.spec.js
  e2e/T6630-T6590-round2-evidence.qa.spec.js
  e2e/T6630-round3-evidence.qa.spec.js
  e2e/T6630-round5-evidence.qa.spec.js
  e2e/T6630-round6-evidence.qa.spec.js
  e2e/T6630-text-add-remove-drag.qa.spec.js
  e2e/T6700-owner-inapp-intro.qa.spec.js
  e2e/T6710-intro-timeline-segment.qa.spec.js
  e2e/bug27p-expired-annotations.spec.js
  e2e/bug38-autoselect-and-frame-step.qa.spec.js
  e2e/bug39-update-gate-aggressive.qa.spec.js
  e2e/clip-selection-state-machine.spec.js
  e2e/derisk-staging-endcard-copylink.qa.spec.js
  e2e/derisk-staging-export.qa.spec.js
  e2e/full-workflow.spec.js
  e2e/new-user-flow.spec.js
  e2e/regression-tests.spec.js
  e2e/request-storm-regression.spec.js
  e2e/sidebar-scrub-debug.spec.js
  e2e/t4800-orphan-drafts.qa.spec.js
  e2e/t5672-carousel-chevrons-auto-badge.spec.js
  e2e/tutorial-capture-annotate.spec.js
  e2e/tutorial-capture-overlay.spec.js
  e2e/tutorial-capture-publish.spec.js
  ```
  **This list has NOT been triaged file-by-file into the three classes above** — that triage (which
  files are genuinely stale fixtures vs. harness-dependent-by-design vs. rotted evidence specs vs. a
  real, still-unfixed defect) is this task's first implementation step, not already done. Don't
  assume every file belongs to one of the three named classes; some may be real, currently-unfixed
  bugs that happened to also be swept up in this run — triage before bucketing.
- `docs/testing/staging-verification-2026-08-10-RESULTS.md` and
  `docs/testing/derisk-plan-2026-08-11.md` — narrative context for why this list exists.

### Related Tasks
- Follows from the 2026-08-11 derisk pass (Part C of `derisk-plan-2026-08-11.md`).

### Technical Notes
- The bug27p pattern referenced in (b) is the existing precedent for "assert loudly instead of
  silently degrading" — find and follow its actual current implementation rather than reinventing
  the phrasing.
- Do not delete a spec just because it's in the failed list — triage first; some failures in this
  set may be real, currently-unfixed product bugs that happen to overlap with the rot classes above
  and deserve their own bug task instead of being archived away.

## Implementation

### Steps
1. [ ] Triage all 57 files into: (a) stale-fixture/needs-guard, (b) harness-dependent/needs-skip-guard,
       (c) rotted evidence spec/archive-or-delete, (d) real unfixed defect (escalate separately, do
       not silently bucket).
2. [ ] Implement the fast-fail account-status guard (class a).
3. [ ] Implement the explicit skip-guard pattern for harness-dependent specs (class b).
4. [ ] Archive or delete the superseded round-N evidence specs (class c), confirming their
       acceptance criteria are covered by each feature's current live spec before removing.
5. [ ] Re-run the full e2e suite once; the fail count should drop to real, or clearly-explained,
       failures only.

### Progress Log

## Acceptance Criteria
- [ ] Every file in the 57-file list is triaged into a named class (not left ambiguous).
- [ ] Real-account specs fail fast (seconds, not 5-minute timeouts) on stale fixture data, with a
      message that says what's stale.
- [ ] Harness-dependent specs report `test.skip` with a reason instead of a bare failure.
- [ ] Superseded evidence specs are archived or deleted, not silently left to rot further.
- [ ] Any file in the list that turns out to be a real, currently-unfixed product defect is filed as
      its own bug task, not absorbed into this cleanup.
