# T11905: Spotlight tests run instead of skipping

**Status:** TODO
**Impact:** 6
**Complexity:** 2
**Created:** 2026-10-04
**Updated:** 2026-11-13

## In plain words

Eleven browser tests open a draft through a shared helper that looks for a button called Open in Spotlight. The app renamed that button Edit spotlight, so the helper finds nothing and each of those tests reports skipped, not failed; a mobile test in the same family waits 90 seconds for a Create Reel button that no longer exists. Skipped tests are how Spotlight breakages have reached staging unseen. Find the buttons by a fixed test id, not by their wording, and remove the stale known-failure note. Worked when all eleven tests and the mobile test execute on a run.

## Implementer details

- `src/frontend/e2e/helpers/overlayDraft.js` looks for `getByRole('button', { name: 'Open in Spotlight' })` on the tile and in the kebab menu. That string is rendered nowhere in `src/frontend/src`; the tile action is `HOME_TILE.EDIT_SPOTLIGHT = 'Edit spotlight'` (`src/config/displayNames.js`, used in `components/DraftTile.jsx`). The 'In Spotlight (n)' chip lookup above it is already optional and can go.
- 13 call sites in 11 specs, each doing `test.skip(!opened.ok, ...)`: bug38-autoselect-and-frame-step, guide-no-overlap, T10310, T10820, T11740, T12730, T4550, T5676, T6510, T9270-cta-above-fold, T9270-mobile-drawer, T9550.
- Same dead string in `e2e/helpers/targetEnv.js`, T4770 and T6620. 'Create Reel' is waited for in T4880 (Spotlight half, with a dead title fallback 'Export from Framing first to enable Overlay mode'), T4110, T4900, T8480, T8970, `manifests/screenManifests.js` and two tutorial-capture specs; the real button is 'Add spotlight to highlight' and has `data-testid="primary-cta"`.
- Add a `data-testid` to the tile's spotlight action and use test ids in the helpers, so a copy change cannot silently skip tests again.
- Remove the fixed T4880 row from `docs/testing/known-failures.md`.
- Also fix `src/frontend/src/utils/handleOverlayExportCompletion.test.js`, which defines its own `PROJECT_MANAGER: 'project_manager'` while the app's value is `'project-manager'` (`stores/editorStore.js`); import the real constant.
- The diagnosis is from reading the code; run the eleven specs once before and once after to prove the skip and the fix.

## Acceptance Criteria

- [ ] On a stack with a Spotlight draft, each of the eleven specs that use the helper executes its assertions (none reports skipped for a missing button).
- [ ] The Spotlight half of the mobile reachability spec finds its button by test id and passes.
- [ ] No browser-test helper locates a button by 'Open in Spotlight' or 'Create Reel'.
