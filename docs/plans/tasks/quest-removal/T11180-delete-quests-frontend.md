# T11180: Remove quests from the app

**Status:** STAGING
**Impact:** 5
**Complexity:** 3
**Created:** 2026-09-24
**Epic:** [Remove the Quest System](EPIC.md)
**Updated:** 2026-11-14

## In plain words

The quest system, guided steps that paid out credits, is hidden from parents, but about 2,000 lines of it are still wired into 30 app files and 59 test files. Delete it once the funnel events have moved off it (T11175). The tutorial video window goes with it (owner ruling 2026-11-14): nothing can open it today and the thank-you email already links the tutorial. Worked when no quest code remains in the app and the admin Journey still counts every step.

## Ruling

Owner, 2026-11-14: delete the tutorial video window together with quests. No button is added for it.

## Current facts (checked 2026-11-13)

Checked against the code on 2026-11-13. Where the older text further down disagrees, this section is right.

- Every line number in the text below is stale; re-grep.
- Quest-only files today: `stores/questStore.js` and test, `data/questDefinitions.js`, `config/questDefinitions.jsx` and test (no importer in `src`; only `e2e/T4780` imports it), `components/QuestIcon.jsx`, `utils/questAchievements.js` and test, about 195 lines of `quest-*` CSS in `src/index.css`, `src/t8520diag/` with `t8520diag.html`, and the specs `T4780-tutorial-quest-steps` and `T8120-quest-overlay-modal-occlusion`.
- Still wired in: 61 `useQuestStore` or `fetchProgress` lines in about 30 non-test files and 31 `recordAchievement(` call sites; quest sections remain in `new-user-flow.spec.js`, the two T5330 specs, T8520-T8530 and `helpers/targetEnv.js`.
- `components/TutorialVideoModal.jsx` (452 lines) is mounted in `App.jsx` but its only opener lives in the unimported `config/questDefinitions.jsx` behind `TUTORIAL_VIDEOS_ENABLED = false`, and it records a quest achievement itself. Deleting it also removes `config/tutorialVideos.js` and `stores/useTutorialStore.js`.
- Strictly after T11175. The quest lines sit in files the multi-clip removal (T11250, T11260, T11270) edits; start after those merge too.

## Solution (pure deletion, ~2,000 LOC)

- `stores/questStore.js` + test, `data/questDefinitions.js`, `config/questDefinitions.jsx` +
  test, `QuestIcon.jsx` (no importers), `utils/questAchievements.js` + test, `stores/index.js:27`.
- Progress refresh calls: `App.jsx:273-274,292,443,619`; `uploadManager.js:17,1141,1285,1411`;
  `uploadStore.js:6,113`; `projectsStore.js:16,153`; `ExportButtonContainer.jsx:702,814`;
  `useRawClipSave.js:77-78,188,242,287,343`; `profileStore.js:358,368`;
  `handleOverlayExportCompletion.js:46,60,82`. ~30 unit tests mock `questStore`: update.
- Dead CSS `index.css:190-~375` (quest-* classes); the `data-quest-panel` line in
  `modalOcclusion.js:27` (keep the file: `updateGateStore.js:4` uses it); `t8520diag/` +
  `t8520diag.html`; leftover comments (`displayNames.js:148`, `RecapPlayerModal.jsx:320-323`,
  `zLayers.js:58`, `editorStore.js:192`).
- `TutorialVideoModal` is deleted too (owner ruling 2026-11-14), with `config/tutorialVideos.js` and `stores/useTutorialStore.js`.
- E2E: delete `T4780-tutorial-quest-steps.spec.js`, `T8120-quest-overlay-modal-occlusion.qa.spec.js`;
  strip quest sections of `new-user-flow.spec.js`, `T5330*-nuf*.spec.js`, `T8520-T8530...spec.js`,
  `helpers/targetEnv.js:396-403`. T5330's "shared-in content doesn't count as progress" check
  moves to a backend facts test.

## Related Tasks
- Depends on: T11175 (analytics rerouted first)
- Ships in the same deploy as, or before, T11185

## Acceptance Criteria

- [ ] `grep -ri quest src/frontend/src` returns only intentional history labels
- [ ] App boots with bootstrap still returning quest fields AND without them (version skew)
- [ ] Targeted suites green
