# T11240: Remove multi-clip UI from Framing and Spotlight

**Status:** TODO
**Impact:** 7
**Complexity:** 6
**Created:** 2026-09-24
**Updated:** 2026-09-24
**Epic:** [Single-Clip Editor](EPIC.md)

## Problem

Framing carries a full multi-clip editor (clip list, drag-reorder, transitions, add from library,
upload into project, per-clip navigation, summed credit estimates). A project is now exactly one
clip, so all of it goes.

## Solution

Split into reviewable commits (pure deletions may exceed ~200 lines; behavior changes may not).

| Item | Location | Fate |
|---|---|---|
| `ClipSelectorSidebar` (list, reorder, transition select, Add / Upload / From Library, total) | `components/ClipSelectorSidebar.jsx:49-453` | Delete; clip status goes in the existing header (R9) |
| `ClipLibraryModal`, `UploadClipModal` | imported only by the sidebar | Delete |
| Sidebar mount, mobile sidebar, "N clips" toggle, `sidebarProps` | `screens/FocusScreen.jsx:1418-1488` | Delete |
| Select / delete / add / upload / add-from-library handlers | `FocusScreen.jsx:1341-1380`, `handleFileSelect` :1021 | Delete |
| Clip-switch restore effect (incl. T10740 guard :733) | `FocusScreen.jsx:716-791` | Delete; mount path :617-700 already uses `clips[0]` |
| Store: `globalTransition`, `addClip`, `deleteClip`, `reorderClips`, `addClipFromLibrary`, `uploadClipWithMetadata`, `removeClip`, `getSelectedClipIndex` | `stores/projectDataStore.js:52,83-109,279-372,399` | Delete |
| Cockpit Clips sheet + rail button | `modes/focus/cockpit/FocusCockpit.jsx:57,262,281-284`; `ActionRail.jsx:41,99` | Delete |
| Multi-clip export branch, summed credits, unframed counts | `containers/ExportButtonContainer.jsx:519-525,625-666,1115-1172`; `ExportButtonView.jsx:48,112,166` | Always call `/render` |
| Project "Total" chip, `isMultiClip`, preview disclosure | `FocusModeView.jsx:452,866,936-939`; `FramingActionRow.jsx:19,60`; `EDITOR_PANELS.PREVIEW_MULTI_CLIP_DISCLOSURE` | Delete |
| `sumEffectiveDurations`, `projectEffectiveDuration` | `utils/effectiveDuration.js`; `FocusContainer.jsx:175-302` | Simplify |
| `clipIndex` deep link | `useProjectLoader.js:97,207,259`; `pendingNavigation.js:149-174` | Delete |
| `reelStaleness.js` / sidebar `isClipStale` (T8350) | `utils/reelStaleness.js` | Delete if no single-clip consumer |

Keep in this task: `selectedClipId` naming (derive as `clips[0].id`; every surgical `focusActions`
call is keyed by clip id) - the collapse is T11270. `useClipManager` shrinks to "the clip".
Legacy multi-clip drafts (T11220) must still open for Spotlight / publish.

## Context

### Tests
Delete: `ClipSelectorSidebar.test.jsx`, `ClipLibraryModal.honestZero.test.jsx`,
`__tests__/UploadClipModal.noSport.test.jsx`. Rewrite: `effectiveDuration.test.js`,
`ExportButtonContainer.test.js`, `ExportButtonView*.test.jsx`, `FocusCockpit.test.jsx`,
`FramingActionRow` / `FocusModeView.framingActionRow`, `SegmentedProgressStrip.test.jsx`,
e2e `T5790`, `T8510-export-guard`.

### Related Tasks
- Depends on: T11220
- Blocks: T11250 (frontend stops calling before endpoints go), T11270
- Downstream: the focus-landscape cockpit (T10840 D13 "Multi-clip filmstrip: sheet only") loses its Clips sheet
- **Preserve (T10190, merged PR #492, do not delete):** `FocusScreen.jsx`'s completion-preview
  payload shaper (currently ~1384-1389 comment + ~1613-1623, feeds `gameName`/`gameStartTime`/
  `gameId` to `CollectionPlayer` and gates the "Back to game plays" backlink via `onBackToGame`).
  It's a different concern (result-surface title/backlink, not clip selection) living in the same
  file this task guts — line numbers will drift as this task deletes ~1,700 LOC around it; grep
  `T10190` in `FocusScreen.jsx` before finishing to confirm the block still compiles and still
  fires on a single-clip completion.

## Acceptance Criteria

- [ ] Red-then-green: Framing on a single-clip project renders no clip list and exports via `/render`
- [ ] Credit estimate equals the single clip's cost (test)
- [ ] Legacy multi-clip draft opens, re-framing refused with the T11220 message
- [ ] Live-driven desktop, 393 px portrait and the landscape cockpit
