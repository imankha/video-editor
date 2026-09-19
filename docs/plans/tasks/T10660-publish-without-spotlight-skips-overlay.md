# T10660: "Publish without spotlight" must never route the user through the Overlay editor

**Status:** STAGING
**Impact:** 6
**Complexity:** 3
**Created:** 2026-09-19
**Updated:** 2026-09-19
**Tier:** M (frontend only, ~5 files, no schema; one small new util)

## Problem

User, 2026-09-19:

> I hit "Add without spotlight" and it took me to overlay, then bounced me out, it should
> have never took me to overlay.

The card is "Publish without spotlight" on Focus's post-render completion preview. Choosing
it means "I do not want the Spotlight editor", and the app answers by opening the Spotlight
editor, letting it hydrate the working video, rendering there, and then throwing the user
out to the finished-reel preview. The Overlay visit is pure implementation leakage.

### Root cause (verified 2026-09-19)

`FocusScreen.handlePublish` (~L1190) does:

1. stake `publishIntentStore.set(projectId)`
2. `setEditorMode('overlay')`
3. `onPublishWithoutSpotlight(projectId)` -> `App.handleScheduleOverlayPublishExport` ->
   `scheduleOverlayPublishExport` (`utils/scheduleExportWhenReady.js`), which polls until
   OVERLAY's export button has mounted and then calls `triggerExport()` on it.

The mode switch exists ONLY because the render had to be fired through a mounted export
button, and the only export button that speaks "overlay" lives inside `OverlayScreen`. That
is why T9740 needed two separate refs and a readiness poll: it was fighting a mechanism whose
premise is wrong.

The premise is wrong because `POST /api/export/render-overlay` is fully backend authoritative.
Its entire request body is `{ project_id, export_id, effect_type }`
(`ExportButtonContainer.jsx:741`), and the endpoint reads highlights, text overlays and effect
settings from `working_videos` itself (`routers/export/overlay.py:2620`). Nothing about the
render needs the Overlay screen to be mounted, or even to exist.

## Solution

Fire the overlay render headlessly from Focus. The user never leaves Focus.

### 1. New `src/frontend/src/utils/startOverlayPublishRender.js`

A small, injectable module (same shape as `scheduleExportWhenReady.js`, which it replaces):

```js
// generate exportId -> useExportStore.startExport(exportId, projectId, 'overlay')
// -> exportWebSocketManager.connect(exportId, { onProgress, onComplete, onError })
// -> POST /api/export/render-overlay { project_id, export_id, effect_type }
// -> on 200 (sync path) OR WS complete frame: fire the completion ONCE (local one-shot ref)
```

This is the second copy of the overlay-render start sequence (`ExportButtonContainer`'s
overlay branch is the first). That is deliberate and within the "abstract on the 3rd
duplication" rule: extracting the start path out of the 1000-line `ExportButtonContainer`
(health check, credits, error UI, reconnect, blob paths) is a separate refactor and is NOT in
scope here. Keep the new module small and make the duplication explicit in its doc comment.

**Double-delivery:** a no-keyframes overlay render takes the backend's synchronous-200 path
AND sends a WS `status:"complete"` frame, so completion arrives twice. Two guards, both
required, both already proven: the module's own one-shot ref, plus
`handleOverlayExportCompletion`'s synchronous publish-intent stake claim (the T9740 fix, do
not touch it).

**Errors:** the POST failing, a 409 `export_in_flight`, or a WS error now gives a precise
failure point that the old poll never had. Clear the stake, surface the toast, leave the user
on Focus with the preview still open. The 5-minute `PUBLISH_INTENT_TIMEOUT_MS` safety net
stays as a backstop, but it should no longer be the primary error path.

### 2. `FocusScreen.handlePublish`

- DELETE `setEditorMode('overlay')`.
- Keep the preview OPEN and pass `publishLoading` to `FocusPublishActionBar` (the prop exists
  and is currently never supplied) so the user keeps watching their video while it publishes.
- Keep the re-entrancy guard, the stake, `acknowledgeCompletionJob()`, and the
  `overlay_declined` achievement exactly as they are.
- `onPublishWithoutSpotlight(projectId)` keeps its signature. Only App's implementation changes.

### 3. `App.jsx`

- `handleScheduleOverlayPublishExport` becomes `handlePublishWithoutSpotlight`: it calls
  `startOverlayPublishRender` and, on completion, calls the EXISTING `handleExportComplete({
  projectId, mode: EDITOR_MODES.OVERLAY })`. The mode in that payload describes the RENDER
  TYPE, not where the user is standing. Say so in a comment: it is the one thing a reader will
  trip over.
- DELETE `overlayExportButtonRef` and its wiring if nothing else uses it (check the
  mode-switch dialog and the payment-return auto-export first; `focusExportButtonRef` stays).

### 4. `handleOverlayExportCompletion.js` navigation gate

Today's navigation branch is `currentMode === EDITOR_MODES.OVERLAY && completed.projectId ===
currentProjectId`. With the fix the one-tap publisher is standing in FRAMING, so that gate
would never fire and the user would be stranded on Focus after publishing. Widen it to "still
in the editor for this project" (FRAMING or OVERLAY). The publish decision stays gated ONLY on
the stake. Do not merge the two decisions: that separation is the T9740 fix.

### 5. Delete the dead mechanism

`scheduleExportWhenReady.js` (both exports) and `scheduleExportWhenReady.test.js` lose their
only caller. Delete them in the same commit, and drop the now-stale T9740 ref-sharing
commentary from `App.jsx` / `FocusScreen.jsx`. Keep a one-line pointer to why the poll existed
so the next reader does not reinvent it.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/screens/FocusScreen.jsx` -- `handlePublish` (~L1190), preview stays open (SHARED with T10650)
- `src/frontend/src/App.jsx` -- `handleScheduleOverlayPublishExport` (~L615), `overlayExportButtonRef` (~L577)
- `src/frontend/src/utils/handleOverlayExportCompletion.js` -- navigation gate only
- `src/frontend/src/utils/scheduleExportWhenReady.js` + its test -- DELETE
- `src/frontend/src/utils/startOverlayPublishRender.js` -- NEW
- `src/frontend/src/components/FocusPublishActionBar.jsx` -- read only (`publishLoading` already supported)
- `src/frontend/src/services/ExportWebSocketManager.js`, `src/frontend/src/stores/exportStore.js` -- read only, the plumbing being reused
- `src/frontend/src/hooks/useExportManager.js` -- read only. It already wraps startExport + WS connect, but it currently has ZERO consumers. Use it only if the worker confirms it behaves; otherwise leave it alone and do not "adopt" it as part of this task.

### Knowledge Docs
- `.claude/knowledge/export-pipeline.md` (render-overlay, export jobs, the T9540 in-flight guard)
- `.claude/knowledge/keyframes-framing.md` (Focus completion preview)

### Related Tasks
- T8390 (one-tap publish), T9740 (the ref-sharing fix this supersedes), T9110/T9590 (the action bar), T10050 (completion store).
- T10650: same user report, SHARED FILE `FocusScreen.jsx`. Strict order: T10650 lands first, then this rebases.

### Technical Notes
- `effect_type`: `FocusModeView` passes `highlightEffectType={null}` today because Focus has no
  effect picker. Send the same default `ExportButtonContainer` uses
  (`HighlightEffect.DARK_OVERLAY`); with no enabled highlight keyframes the effect is a no-op,
  and `working_videos.effect_type` is what the renderer actually reads.
- `GlobalExportIndicator` already renders progress from `exportStore`, so registering the job in
  the store is what gives the user a progress signal without the Overlay screen.
- Landing on the finished-reel preview after the publish completes is CORRECT and stays. The bug
  is the Overlay detour, not the destination.
- The Overlay tab in the mode switcher is untouched. A user who wants Spotlight still gets there
  through "Add spotlight".

## Acceptance Criteria

1. From the Focus completion preview, "Publish without spotlight" never changes `editorMode`.
   Assert on the store, not on pixels.
2. The preview stays open with the Publish card in its loading state while the render runs, and
   render progress is visible.
3. On completion the reel is published exactly once and the user lands on the finished-reel
   preview, as today.
4. Double delivery (HTTP 200 plus WS complete) publishes once. Red/green test required.
5. A failed render (POST rejected, 409, or WS error) clears the stake, shows an error toast, and
   leaves the user on Focus with the preview open. No silent stranding.
6. `scheduleExportWhenReady.js` is gone and nothing imports it.
7. "Add spotlight" still goes to Overlay and still never starts a render on its own.

## Test Scope (curated, ~10)
- NEW `utils/startOverlayPublishRender.test.js` (POST shape, one-shot completion, error path)
- `utils/handleOverlayExportCompletion.test.js` (existing, extend: navigates from FRAMING; still publishes once on double delivery)
- FocusScreen unit coverage for `handlePublish` (no `setEditorMode`, `publishLoading` true, stake claimed once on a double click)
- Any existing test referencing `scheduleOverlayPublishExport` or `overlayExportButtonRef` (retire with the mechanism)
- e2e: Focus completion -> Publish without spotlight -> published reel, asserting Overlay never mounts

## Agents
| Agent | Include? | Justification |
|-------|----------|---------------|
| Code Expert | No | Root cause and seams are mapped above |
| Architect | No | M-tier, approach settled here |
| Tester | No | Curated set above |
| Reviewer | YES | Mandatory M-tier review on the diff; this touches the publish path that has regressed twice |
| Migration | No | No schema change |

**Escalate to the expert agent** (do not grind) if the WS/HTTP completion wiring does not come
out clean on the first attempt. This exact path burned three rounds in T9740.

## Implementation

(worker fills in)
