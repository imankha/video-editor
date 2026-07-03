# T4480: Kill the clipMetadata Event-Bus + Single Overlay-Data Loader

**Status:** TODO
**Impact:** 7
**Complexity:** 4
**Created:** 2026-07-03
**Epic:** [editor-decoupling](EPIC.md) · Audit items D2 + G2-partial

## Problem

[SYNC][DEP] `projectDataStore.clipMetadata` is simultaneously (a) stored derived data (built by `buildClipMetadata` from clips, `useProjectLoader.js:43-63`) and (b) a **cross-screen message**: FramingScreen sets it after export (:964-967), OverlayScreen's effect (:432-497) consumes it — and its FIRST act is `setOverlayClipMetadata(null)`, a store write acknowledging a message. Because `useProjectLoader:189-192` ALSO sets it on every project load, "fresh export detected" fires on ordinary opens. Store-as-event-bus is the T350 feedback-loop shape; any second subscriber or re-set retriggers a full overlay-data reload mid-edit (resetting regions/effect/colors under the user).

Compounding it: OverlayScreen has TWO nearly identical 60-line overlay-data loaders (:432-497 keyed on the metadata signal; :516-562 keyed on `overlaySyncState === 'idle'`), each applying 8 settings fields — the 5 tuning setters were already wired twice (:480-484, :545-549). Every new overlay setting must be added in both or it loads on only one entry path.

## Solution

1. **One `loadOverlayData(projectId, duration)`** function (Screen-level or a small module) that fetches `/overlay-data` and applies ALL settings in one place. Both triggers call it.
2. **Explicit handoff replaces the bus:** the export→overlay transition passes "fresh export" as a navigation payload/function argument (find the navigation mechanism — App.jsx `pendingNavigation` breadcrumb pattern from T3960 is the house precedent). OverlayScreen never watches a store field to detect it.
3. **Stop storing clipMetadata:** derive at read time via a selector over clips + `clipMetadataCache` (audit frontend-sync #2). Check every consumer (`grep -rn "clipMetadata" src/frontend/src`) — migrate reads to the selector.

## Context

- Files: `screens/OverlayScreen.jsx`, `screens/FramingScreen.jsx:964-967`, `hooks/useProjectLoader.js`, `stores/projectDataStore.js`, `App.jsx` (navigation payload)
- Behavior to preserve EXACTLY: what the "fresh export" path does differently from a plain open (read both effects side-by-side first; diff-table them in the Progress Log — that diff is the actual contract being made explicit).
- Related: T1670 family (overlay stuck loading after export) — regression-test that flow specifically.

## Steps

1. [ ] Diff-table the two loader effects; extract `loadOverlayData` covering the union; both call sites green.
2. [ ] Navigation-payload handoff; delete the metadata-watching effect + the null-acknowledge write.
3. [ ] clipMetadata → selector; delete the store field + its 3 writers.
4. [ ] E2E: export→overlay transition; plain open; overlay retains user edits when nothing changed.

## Acceptance Criteria

- [ ] One overlay-data loader; adding a setting is a one-place change
- [ ] No store field functions as a cross-screen message (clipMetadata gone from the store)
- [ ] "Fresh export" logic runs ONLY after an actual export
- [ ] Export→overlay E2E + mid-edit no-spurious-reload test green
