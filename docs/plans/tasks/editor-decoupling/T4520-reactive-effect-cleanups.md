# T4520: Reactive-Effect Cleanup Batch

**Status:** TODO
**Impact:** 6
**Complexity:** 4
**Created:** 2026-07-03
**Epic:** [editor-decoupling](EPIC.md) · Audit items D6 + D7 + frontend-sync #3/#4/#5/#7/#13/#16/#17/#18/#20

## Problem

[SYNC][DEP] Grab-bag of verified small violations — each is an effect doing a gesture's job, a duplicated derivation, or stored derived state. Batched because each is < 1 day and they share test surfaces.

## The list (fix each; every item names its verified location)

1. **Audio auto-toggle race:** `ExportButtonContainer.jsx:310-318` — effect watches `segmentData`, calls `onIncludeAudioChange(false)` on slow-mo detection; can flip the user's re-enabled audio back off on re-render. Move into `handleSegmentSpeedChange` (the gesture), or derive "audio forced off" at export time.
2. **Toast dismissal via identity-watching effects, duplicated:** `AnnotateContainer.jsx:1107-1111` + `OverlayScreen.jsx:749-753` watch collection identity and call `dismissExportCompleteToast()` — restores/refetches re-emit arrays and dismiss without user action. Call dismiss inside the existing gesture wrappers (`wrappedAdd*`, `updateClipRegionWithSync`, …).
3. **Clip default-selection triple-owner:** `projectDataStore.js:122` + `:150` decide selection; `useClipManager.js:87-91` ALSO watches clips/selection and writes selection back. Keep it in the store only; delete the hook effect.
4. **`getFilteredKeyframesForExport` duplicated verbatim:** `FramingScreen.jsx:750-784` ≡ `FramingContainer.jsx:862-896` (35 lines). Keep the container's; Screen uses it.
5. **FramingScreen triple load/restore paths:** `:490-507` (mount layout-effect), `:511-574` (clips-keyed + restore), `:588-652` (clip-switch + its own restore copy), coordinated by 4 refs + a promise cache added to absorb their duplicate fetches. Extract ONE `loadClipIntoEditor(clipId)` used by mount and switch; restore logic exists once.
6. **gamesDataStore stored derivations:** `readyGames`/`pendingGameIds` cached (:31-32) with triple-write lockstep (:57-59, :87-89, :364-371) + `gamesVersion` refetch counter (:39-48). Compute via selector hooks (`useShallow`); delete the counter (subscribers re-render off `games` itself).
7. **`hasFramingEdits`/`effectiveOverlayVideoUrl` computed in 3/2 places with different logic:** `FramingContainer.jsx:147-159`, `OverlayContainer.jsx:105-117/:123-139`, `OverlayScreen.jsx:155-160/:763-777` (the last reads nonexistent `firstClip.cropKeyframes` — coordinate with T4270 item 3). One selector module; all consumers import it.
8. **`setGlobalAspectRatio` stale transform path:** `useClipManager.js:130-171` client-side rewrites crop_data from `clipMetadataCache`, never hits the backend; still exported + passed as a prop (`FramingScreen.jsx:354`) though the live path is T3910's server-side action. Delete the transform path + prop.
9. **AnnotateScreen mount side effect inside useState initializer:** `AnnotateScreen.jsx:77-83` (+ render-time ref writes :356-361, :589-591). Fold into the mount effect / lazy ref init (StrictMode double-invoke hazard).
10. **Export dirty-tracking divergence:** framingStore hash-based vs overlayStore boolean (audit C11). Extract `createExportDirtySlice()` — the codebase's first store slice factory; both stores consume it. (framingStore's dead export-hash fields may already be gone via T4440 — reconcile.)

## Steps

1. [ ] One commit per item, test-first where an item pins a behavior change (1, 2, 3, 5, 8 especially).
2. [ ] Items 5 + 7 are the substantial ones — do them last, with E2E editor flows after each.
3. [ ] Run the T4290 lint (if landed) — several items clear its violation list; annotate any remaining.

## Acceptance Criteria

- [ ] Items 1-10 each closed with its own commit + test evidence
- [ ] No effect dismisses toasts / writes selection / flips audio (grep-verifiable patterns)
- [ ] One restore path in FramingScreen; one selector per derived fact
- [ ] gamesDataStore stores raw data only; version counter gone
