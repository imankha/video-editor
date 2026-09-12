# T9740: "Publish without spotlight" doesn't publish in one tap

**Status:** STAGING
**Impact:** 6
**Complexity:** 3
**Created:** 2026-09-12
**Updated:** 2026-09-12

## Source

Found live on staging during T9710's verification (`docs/plans/tasks/T9710-publish-and-draft-destination-verification.md`,
section "AC2 — Publish without spotlight"). Not a privacy issue - a functional/copy contract break
on the exact button T9590 designed as the secondary one-tap publish path.

## Problem

The T9590 post-Focus dialog's **Publish without spotlight** button is captioned *"Adds it to your
Highlight Reels as is - anyone with the link can watch it"* - a one-tap promise. It does not do
that. Clicking it:

1. Navigates to `/overlay` and opens the full interactive Spotlight editor, with a highlight region
   already auto-added from AI Focus's player-detection pass - i.e. the "decline spotlight" choice
   lands the user on a screen that has already half-configured a spotlight.
2. The code's own documented one-tap mechanism never fires: `handlePublish`
   (`src/frontend/src/screens/FocusScreen.jsx:1128-1147`) calls `setEditorMode('overlay')` then
   `setTimeout(() => exportButtonRef.current?.triggerExport(), 500)` - the comment above it
   (`:1118-1127`) explicitly says *"ONE tap, TRUE publish... fires the same spotlight-less overlay
   render... App.jsx's shared export-completion handler... reads that flag when THIS project's
   render completes and auto-runs the publish gesture."* On staging, no second `/api/export/render*`
   request fired at all - confirmed by watching the network log for 90+ seconds after the click.
3. The user is left stranded on the Overlay editor with only a manual **"Export clip with effects"**
   action available - the opposite of "without spotlight" framing (it's costed/labelled as an
   effects export).
4. Manually clicking that fires `POST /api/export/render-overlay` and lands the clip in "Ready to
   Publish" - still not published.
5. A further manual **Publish** click there finally fires `POST /api/downloads/publish/{id}` and the
   clip correctly lands in Published.

**Net: 3 manual gestures instead of the promised 1, one of them through spotlight-editing UI the
user explicitly declined.** The eventual end state (published, correct link, correct audience) is
right per T9710's AC4 - this is a broken intermediate path, not a data-correctness or privacy bug.

**Contrast case confirmed working**: choosing **Add spotlight** from the same dialog (T9710 AC3)
lands directly and correctly in the Overlay editor with one clean Export -> Publish flow matching
its own copy. The bug is specific to the "decline spotlight" shortcut's auto-trigger.

## Root Cause (hypothesis, not confirmed - next task should verify before fixing)

`exportButtonRef.current?.triggerExport()` at `FocusScreen.jsx:1146` most likely resolves to
`undefined`/a stale ref at the 500ms mark - `setEditorMode('overlay')` triggers a re-render/remount
of the Overlay-mode `ExportButtonContainer` that owns `exportButtonRef`, and 500ms may not be
sufficient (or the ref may not yet be attached) once React actually swaps editor modes, versus
whatever local/dev conditions this fixed timeout was originally tuned against. Confirm with a real
repro + console/breakpoint on the ref value at the callback, don't assume this diagnosis is complete
- the QA agent explicitly could not conclusively determine why the trigger silently no-ops.

## Context

### Relevant Files
- `src/frontend/src/screens/FocusScreen.jsx:1118-1147` - `handlePublish`, the ONE-tap mechanism that
  isn't firing
- `App.jsx`'s shared export-completion handler (referenced in the comment above `handlePublish`, T8530's
  "land the user on the finished reel" block) - reads `publishIntentStore` when the render completes
  and should auto-run the publish gesture
- `publishIntentStore.js` - the cross-component signal `handlePublish` stakes before triggering
- `ExportButtonContainer` (overlay mode) - owns the ref `exportButtonRef.current.triggerExport()` is
  called on

### Related Tasks
- Found during: T9710 (verification task, no code - this is the filed follow-up)
- Introduced/owned by: T9590 (post-Focus choice hierarchy - designed this exact button and its
  one-tap promise), T8390 (original "Finish Now" -> "Publish" one-tap mechanism this reuses)

### Technical Notes
Reproduce on staging (or local dev against staging-equivalent code) with a fresh AI-Focus-completed
clip, click "Publish without spotlight" from the T9590 dialog, and watch the network tab for the
second `/api/export/render-overlay` (or `render*`) call that should fire ~500ms after entering
Overlay mode. If it doesn't fire, add logging/a breakpoint at `FocusScreen.jsx:1146` to see whether
`exportButtonRef.current` is null, or whether `triggerExport` throws/no-ops silently.

## Acceptance Criteria

- [x] Root cause of the missing auto-trigger confirmed (not just the hypothesis above)
- [ ] "Publish without spotlight" completes in one tap on both staging and local dev, matching its
      own caption - no stranding on the Overlay editor
- [x] "Add spotlight" path (T9710 AC3) continues to work exactly as it does today - no regression
- [x] Regression test added that would have caught this (the failure mode is exactly "happy path UI
      looks fine, the async auto-trigger silently no-ops" - inject/observe the actual async
      completion, don't just assert the button click doesn't throw)
- [x] Relevant test set (curated ~10, per CLAUDE.md Test Scope Policy) green, with output attached
- [x] Branch CI green (red only on the already-documented pre-existing `uploadManager.attachVideo.test.js`
      flake, unrelated to this diff - see `docs/testing/known-failures.md`)

## Resolution (2026-09-12)

**Confirmed root cause**: `FocusScreen.handlePublish`'s fixed `setTimeout(() => exportButtonRef.current?.triggerExport(), 500)`
raced Overlay mode's async video hydration. `workingVideo` is explicitly nulled by `FocusScreen`
(~line 1030-1032) before the overlay mount, and hydrating it again takes 2+ async fetches -
`OverlayScreen.effectiveOverlayVideoUrl` (which gates whether `OverlayExportButtonSection`, and
therefore `exportButtonRef`, mounts at all) routinely stays null past the 500ms mark, so
`exportButtonRef.current` was `null` and `triggerExport()` silently no-opped. 500ms was never a
safe margin, not a value that needed re-tuning. (StrictMode double-render and `setEditorMode`
batching timing were both investigated and ruled out.)

**Fix**: extracted a bounded readiness-poll scheduler (`src/frontend/src/utils/scheduleExportWhenReady.js`)
that waits for the export button to actually be ready before firing, using the existing
`publishIntentStore` stake as its sole stop condition (no new deadline/magic number to re-tune
later). Chosen over a reactive `useEffect` (wrong causality/edge-trigger fragility) and a new
`onReady` callback prop (over-built, new prop chain) after an Opus expert-agent design consult, per
this project's async-timing escalation policy. Reviewed by a fresh-context Reviewer: APPROVED, 0
blocking/major, 3 minor (2 applied as doc polish).

**Verification gap, needs staging confirmation**: full end-to-end live-drive of the actual race
(real AI-Focus render -> Overlay hydration -> auto-trigger -> Published) could not be exercised in
the dev-container sandbox (Modal disabled, no seeded fixture data - an existing, already-documented
sandbox limitation per `e2e/T8520-T8530-overlay-choice-and-publish.spec.js`'s header, not new to
this task). Verified instead via a real red->green proof against the actual `scheduleExportWhenReady.js`
module (not a mock/argument-shape check) plus the full curated relevant test set green. **The "one
tap on staging" criterion above is left unchecked until someone live-drives it on staging** -
merged per this project's merge-when-provably-verified policy (genuine red->green proof + CI green
modulo the known pre-existing flake), consistent with "staging IS the test phase."

PR: #417 (merged, `0e9ae01f`). Branch: `feature/T9740-publish-without-spotlight-not-one-tap` (deleted post-merge).
