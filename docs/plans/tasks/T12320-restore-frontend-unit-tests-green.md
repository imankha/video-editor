# T12320: Restore the frontend unit-test suite to green (97 failing tests on master)

**Status:** WAITING ON USER (the 22 files are fixed and landed; items 1-6 under "Remaining" need decisions or a real Playwright run)
**Impact:** 6
**Complexity:** 5
**Tier:** M
**Created:** 2026-10-08
**Updated:** 2026-10-08
**Milestone:** [Staging QA Walkthrough](staging-qa-2026-10-08/README.md)
**Found by:** T11970 landing (Branch CI run 37813940851)

## Problem

Master CI was red. At 579564bff the frontend job failed at the ESLint regression gate (a literal backslash-n at the end of ExportButtonView.test.jsx plus a duplicate import in FocusModeView.guidedSteps.test.jsx), so vitest never ran there. T11970 fixed both lint errors, which let vitest run, and it reported **97 failing tests in 22 files out of 217**. The same 97 fail on a pristine origin/master checkout (fresh npm ci), so none were caused by T11970. Branch CI could not be green for any task until these were fixed.

Failing files at filing time (failing test count in each):

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

## What was found and done (T11960 branch, landed as 7adf86e74)

Verified per file; the original "copy drift" hypothesis was only partly right. Branch CI was green on 61289d8be (run 37820055607).

| Cause | Files | Resolution |
|-------|-------|------------|
| Test mocks of `settingsStore` lacked `useGuidanceSettings` (685 error lines) | 8 `ProjectManager.*` files | Added `useGuidanceSettings: () => ({ coachEnabled: true })` to each mock |
| Intentional UI changes (3662653a0 CTA/guidance unification, 31b50fab5 action cards, a2432f7b6 floating coach, 134b1c6c4 opt-in advanced editing, c6e6708fa highlight actions) | PrimaryCta, questDefinitions, 7 AnnotateModeView files, FocusModeView advancedEditing + guidedSteps, OverlayModeView textLaneDisclosure | Tests updated to current behavior, keeping what each was meant to guard |
| Real regression: backend `quest_config.py` `export_overlay` still "Generate Highlight with Overlay" after the frontend went sentence case | questDefinitions (mirror test) | Backend string fixed |
| Real regression: coach "Turn off guidance" X button inherited `pointer-events-none` inside the Spotlight overlay, so it was unclickable | SpotlightPickGuide | `pointer-events-auto` added in InstructionCoach |
| Real regression: "Share with tagged players" never rendered (gated on `coachModel.phase !== 'watch'`, always true with nothing selected); it is the only tagged-share entry | AnnotateModeView.shareWiring | Gate dropped |
| 4e4a18c1b stopped rendering the tab body copy; Games coach said "Press on a game" even with zero games | EmptyTabGuide (4), ProjectManager.addVideo (2) | Per user ruling: tests assert what renders; unrendered `EMPTY_TAB_GUIDE.*.body` strings deleted; Games coach now says to upload a game (pointing at Upload game) at zero games, "Press on a game" otherwise (copy lives in `EMPTY_TAB_GUIDE.games.coachNoGames/coachWithGames`) |

No test was skipped or deleted. Note: the later commits on that branch had green CI but no fresh independent Reviewer pass (the Reviewer and Proof Verifier covered only the T11960 label fix, d64355533).

## Remaining

1. **e2e selector drift.** 24 uses of `[data-testid="annotate-primary-cta"]` across 13 Playwright specs still mean the Mark/Add Play button, which is now `annotate-mark-play-button` (`annotate-primary-cta` is only Edit play). Branch CI does not run Playwright, so this needs a real run. Files under `src/frontend/e2e/`: clip-selection-state-machine, cta-visibility, T10710, T10800, T11110, T11150, T8490, T8600, T8760, T8900, T8960, T9480, T9580.
2. **Decision: Overlay Text lane can no longer be hidden once shown.** 3662653a0 deleted the disclosure toggle; textLaneDisclosure tests were rewritten around "Add text". Restore a hide toggle?
3. **Decision: Annotate "6 seconds before, 2 after" capture-window hint is gone.** `ANNOTATE.MARK_PLAY_HELPER` is dead code and the coach watch body is empty; `docs/designs/instruction-coach-system.md` says it should move to a supporting line or a Why? disclosure. The firstRunDisclosure test that guarded the numbers was rewritten.
4. **Decision: a locked Review plays card looks the same as an enabled one.** T11750's visual cues (no outline, Lock icon, dimmer text) were removed in 31b50fab5; only `aria-disabled` and the toast remain.
5. **Minor: Edit play card accessible name** runs title into description with no separator ("Edit playAdjust the timing..."). Tests currently match `/^edit play/i`.
6. **Minor: Annotate coach guidance is no longer first-run only** (design doc says it disappears after the first play). The test "the helper is not shown once the game has plays" now passes vacuously because `mark-play-helper` never exists.

**Hand-off (2026-10-10):** filed as T12370 (item 1), T12400 (2), T12410 (3), T12420 (4), T12380 (5), T12390 (6). Items 2-4 are product-feel calls and 5-6 are minor, so they are checkpoints in the [T12310 walkthrough](staging-qa-2026-10-08/T12310-re-run-staging-walkthrough.md) rather than blind decisions. Item 1 (e2e selectors) is done first as its own small task so the walkthrough starts from known-good specs. Close this task by splitting out whatever the walkthrough rules on.

## Context

### Related Tasks

- T12310 walkthrough re-run: judges items 2-6.
- Found by T11970. Fixed on the T11960 branch because Branch CI could not be green without it.

### Technical Notes

Reproduce the original state: `cd src/frontend && npx vitest run <the 22 files>`. Local runs stay curated per CLAUDE.md; Branch CI is the full-suite verdict.

## Implementation

### Steps

1. [x] Re-run the 22 files on current master; record the failing names
2. [x] Classify each failure: intentional copy/structure change vs real regression
3. [x] Update tests for intentional changes; fix real regressions
4. [x] Branch CI green on the final head, including the Unit tests (vitest) step (61289d8be, run 37820055607)
5. [ ] Resolve Remaining items 1-6

### Progress Log

**2026-10-08**: Filed from the T11970 landing. T11970 landed on red CI by explicit user decision.

**2026-10-08**: Triaged and fixed on branch feature/T11960-hide-crop-debug-label (three parallel file-disjoint groups, results above), landed with T11960 as 7adf86e74. Remaining items 1-6 recorded; none block CI.

## Acceptance Criteria

- [x] The 22 listed files pass
- [x] Branch CI frontend job green, vitest step included
- [x] No test skipped or deleted to get green
- [ ] Master CI green after the T11960 merge (verify)
- [ ] Remaining items 1-6 resolved or split into their own tasks
