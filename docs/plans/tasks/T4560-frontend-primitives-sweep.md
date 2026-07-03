# T4560: Frontend Primitives Sweep — timeFormat, Constants, Contexts, Modal/Spinner, apiJson

**Status:** TODO
**Impact:** 6
**Complexity:** 4
**Created:** 2026-07-03
**Source:** Audit items C9 + C13/C18/C19 (frontend DRY #11/#12/#13/#18/#19) · Absorbs refactoring-standards leftovers T301/T302/T303

## Problem

[DRY] Five mechanical consolidations; none changes behavior, all shrink the "which copy is real?" search space. Grouped because each is < 1 day and they're independent (any subset can land).

## The sweep

1. **Time formatting (9+ copies, divergent edge cases):** canonical `utils/timeFormat.js`; duplicates at `ClipRegionLayer.jsx:5-13` + `ClipListItem.jsx:7-15` (character-identical), `ClipScrubRegion.jsx:11`, `useDownloads.js:228-239`, `ClipLibraryModal.jsx:13`, `GameClipSelectorModal.jsx:157`, `collections/format.js`, and a SECOND exported `formatTimeSimple` in `shared/clipConstants.js:66-82` that differs from timeFormat's. Consolidate; where copies disagree (null → `'0:00'` vs `null`; `Math.round` vs `floor` at .5s), pick per current user-visible behavior of the MOST-USED surface and note each choice.
2. **Constants adoption:** `constants/editorModes.js` has ZERO imports while `editorStore.js:15` defines a second `EDITOR_MODES` and ~15 files use raw `'framing'/'overlay'/'annotate'` literals (FramingScreen.jsx:795, OverlayScreen.jsx:799, UnifiedHeader.jsx:52, QuestPanel.jsx:27/73, ModeSwitcher, editorContext.js:69-84, ProjectManager ×5, …). Delete `constants/editorModes.js`; `editorStore`'s EDITOR_MODES becomes THE constant (re-export from constants/ if layering demands); sweep the literals. Same for `constants/keyframeOrigins.js` (zero imports, 31 raw `'permanent'/'user'/'trim'` literals) — wire into controller + layers. Flips T4290's rule 2 from warn to error when done.
3. **`createStrictContext(name)`:** `modes/framing/contexts/CropContext.jsx` ≡ `modes/overlay/contexts/HighlightContext.jsx` (33 lines, find-replace apart). One factory in `contexts/`.
4. **Modal + Spinner primitives:** 31 files hand-roll `fixed inset-0` backdrop+panel; 48 inline `animate-spin`. Build `components/shared/Modal.jsx` — **backdrop-close disabled by design** (memory "No backdrop close": the primitive makes the rule unbreakable) — and `Spinner`. Migrate incrementally: this task builds the primitives + migrates ~5 highest-traffic modals; the rest migrate opportunistically (note the pattern in ui-style-guide skill, same-PR rule).
5. **`apiJson` helper:** the `apiFetch` → `if (!ok) console.error → {success:false}` try/catch block is repeated across stores (gamesDataStore ×11, projectsStore ×8, projectDataStore ×8, questStore, galleryStore, creditStore, useRawClips, useCollections). `utils/apiJson.js` → `{ok, data, error}`; migrate ONE store fully as the exemplar + tests; rest opportunistic.

## Steps

1. [ ] One commit per sweep item; frontend unit tests + build check each.
2. [ ] Items 4/5: primitives + exemplar migrations only — full migration is explicitly out of scope (avoid a 60-file PR).
3. [ ] Update ui-style-guide / type-safety skills where they reference the old patterns.

## Acceptance Criteria

- [ ] One formatTime family; `clipConstants.js` duplicate gone; divergence decisions recorded
- [ ] Zero raw editor-mode literals outside the constant (lint rule flipped to error)
- [ ] Keyframe origins imported from constants everywhere they're compared
- [ ] Modal primitive enforces no-backdrop-close; Spinner exists; exemplar migrations landed
- [ ] apiJson exemplar store migrated with tests
