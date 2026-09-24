# T11180: Delete the quest system, frontend

**Status:** TODO
**Impact:** 4
**Complexity:** 3
**Created:** 2026-09-24
**Epic:** [Remove the Quest System](EPIC.md)

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
- `TutorialVideoModal` stays (G6); re-key `tutorialVideos.js:3-8` by topic instead of quest id.
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
