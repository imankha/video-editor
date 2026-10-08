# T12320: Restore the frontend unit-test suite to green (97 failing tests on master)

**Status:** TODO
**Impact:** 6
**Complexity:** 5
**Tier:** M
**Created:** 2026-10-08
**Updated:** 2026-10-08
**Milestone:** [Staging QA Walkthrough](staging-qa-2026-10-08/README.md)
**Found by:** T11970 landing (Branch CI run 37813940851)

## Problem

Master CI is red. At 579564bff the frontend job failed at the ESLint regression gate (a literal backslash-n at the end of ExportButtonView.test.jsx plus a duplicate import in FocusModeView.guidedSteps.test.jsx), so vitest never ran there. T11970 fixed both lint errors, which let vitest run, and it reports **97 failing tests in 22 files out of 217**. The same 97 fail on a pristine origin/master checkout (fresh npm ci) and on the T11970 branch, so none are caused by T11970. Branch CI cannot be green for any task until these are fixed, and Master CI now fails on every merge.

Failing files (failing test count in each):

- `src/components/ProjectManager.threeTabIA.test.jsx` (23)
- `src/components/ProjectManager.galleryGuard.test.jsx` (9)
- `src/components/ProjectManager.clipSizeLimit.test.jsx` (7)
- `src/modes/FocusModeView.guidedSteps.test.jsx` (6)
- `src/components/ProjectManager.addVideo.test.jsx` (6)
- `src/modes/AnnotateModeView.highlightInstances.test.jsx` (5)
- `src/modes/AnnotateModeView.cta.test.jsx` (5)
- `src/modes/OverlayModeView.textLaneDisclosure.test.jsx` (4)
- `src/components/shared/EmptyTabGuide.test.jsx` (4)
- `src/components/ProjectManager.legacyReachability.test.jsx` (4)
- `src/modes/FocusModeView.advancedEditing.test.jsx` (3)
- `src/modes/AnnotateModeView.frameClip.test.jsx` (3)
- `src/components/ProjectManager.clipsRing.test.jsx` (3)
- `src/components/ProjectManager.cacheWarming.test.jsx` (3)
- `src/modes/AnnotateModeView.shareWiring.test.jsx` (2)
- `src/modes/AnnotateModeView.addFootageRow.test.jsx` (2)
- `src/config/questDefinitions.test.jsx` (2)
- `src/components/ProjectManager.addGameBeacon.test.jsx` (2)
- `src/modes/overlay/components/SpotlightPickGuide.test.jsx` (1)
- `src/modes/AnnotateModeView.strip.test.jsx` (1)
- `src/modes/AnnotateModeView.firstRunDisclosure.test.jsx` (1)
- `src/components/PrimaryCta.test.jsx` (1)

Pattern seen so far: copy drift (for example the CTA text is now "Generate Highlight" while tests expect "Generate highlight"; tab and guide strings changed by recent UI-unification commits 3662653a0, f69d2f47f, c6e6708fa). Treat that as a hypothesis to verify per file, not a settled cause.

## Solution

For each failing file decide per test: the product copy/structure changed on purpose (update the test to the current behavior) or the product regressed (fix the code and file it if larger than this task). No skipping or deleting tests to get green. Group by cause (copy drift, ProjectManager restructure, AnnotateModeView CTA changes) and land in reviewable commits.

## Context

### Relevant Files (REQUIRED)

- The 22 test files listed above (all under `src/frontend/src/`)
- Their components, only where a test reveals a real regression

### Related Tasks

- Found by T11970. Blocks green Branch CI and Master CI for every other task.

### Technical Notes

Reproduce: `cd src/frontend && npx vitest run <the 22 files>` gives "97 failed | 120 passed". Local runs stay curated per CLAUDE.md; Branch CI is the full-suite verdict.

## Implementation

### Steps

1. [ ] Re-run the 22 files on current master; record the failing names
2. [ ] Classify each failure: intentional copy/structure change vs real regression
3. [ ] Update tests for intentional changes; fix or file real regressions
4. [ ] Branch CI green on the final head, including the Unit tests (vitest) step

### Progress Log

**2026-10-08**: Filed from the T11970 landing. T11970 landed on red CI by explicit user decision.

## Acceptance Criteria

- [ ] The 22 listed files pass on master
- [ ] Branch CI and Master CI frontend job green, vitest step included
- [ ] No test skipped or deleted to get green
