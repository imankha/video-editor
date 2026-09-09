# T9280: Mobile Focus export sometimes lands on the Clips tab instead of the publish-exit preview

**Status:** WIP
**Impact:** 8
**Complexity:** 4
**Created:** 2026-09-09

## Problem

Reported by the user on mobile staging 2026-09-09: after exporting a clip in Focus, the app
landed on the Home "Clips" tab (`ProjectManager`, "YOUR IN PROGRESS CLIPS" / "Ready to Publish"
list) instead of the preview-first completion screen with the 4-button `FocusPublishActionBar`
(Add Spotlight Now / Add Spotlight Later / Publish Now / Finish Now) that T8390 shipped for
exactly this moment. This defeats the whole First Reel Funnel completion-screen investment
(T8390/T8520/T8530/T9110) on at least this one path — the user is dropped at a list instead of
being walked to publish.

## Suspected root cause (needs live confirmation before fixing)

`FocusScreen.jsx` `handleProceedToOverlayInternal` (~line 947-1075) early-returns *before*
`setShowExportCompletePreview(true)` is ever reached:

```js
// line ~956
if (exportedProjectId && exportedProjectId !== currentlyViewingProjectId) {
  // ...
  if (onExportComplete) onExportComplete();
  return;   // <-- never reaches setShowExportCompletePreview(true) below
}
```

`currentlyViewingProjectId` is read fresh from `useProjectsStore.getState().selectedProjectId`
at export-completion time, compared against the `exportedProjectId` the export started for. If
anything nudges `selectedProjectId` between export-start and export-finish (a background
`fetchProjects` re-selecting, a store reset, a mobile backgrounding/foregrounding cycle, or the
export simply taking long enough that the user navigated away and back), this comparison fails
and the screen silently falls back to whatever `onExportComplete` does — which on the App.jsx
side (`handleExportComplete`, App.jsx:582-633) only branches on `EDITOR_MODES.OVERLAY`, so for a
plain **Focus** export it does nothing but refresh data. No preview, no action bar, no explicit
navigation — the user just sees whatever screen they're already on, which lines up with landing
on Clips.

This is a hypothesis, not a confirmed root cause — mobile-specific timing (export duration,
tab visibility changes, possible mobile Safari/Chrome backgrounding behavior) needs to be
reproduced live before deciding the fix. If confirmed, note this is the SAME shape of bug as the
`workingVideo`/metadata pairing bug class T9150 just fixed on Overlay (state read from two
different places at different times going out of sync) — worth checking whether the fix pattern
generalizes.

## Context

### Relevant Files
- `src/frontend/src/screens/FocusScreen.jsx` (~L947-1075) — `handleProceedToOverlayInternal`,
  the early-return branch and the `setShowExportCompletePreview(true)` call it can skip
- `src/frontend/src/App.jsx` (~L582-633) — `handleExportComplete`, the mode-gated
  post-export callback (OVERLAY branch only; no FOCUS branch exists)
- `src/frontend/src/components/FocusPublishActionBar.jsx` — the screen this should land on

### Related Tasks
- Pattern this bypasses: [T8390](T8390-focus-publish-exit.md) (Focus preview-first completion
  screen + `FocusPublishActionBar`, shipped)
- Same bug SHAPE, different surface: [T9150](T9150-overlay-metadata-pairing-and-settings-starvation.md)
  (state read from two out-of-sync sources)
- Sibling on Overlay's side of the same funnel: [T9110](T9110-overlay-publish-exit-action-bar.md)

### Technical Notes
- Mobile-specific report; reproduce on a real mobile viewport/device against staging before
  concluding desktop is unaffected — T5380/T8900 precedent says pointer/lifecycle bugs like this
  need a real-browser check, not just jsdom.
- Check whether the export simply took long enough for something to touch `selectedProjectId`
  mid-flight (backgrounding, a concurrent `fetchProjects`, quest-progress refresh) rather than
  assuming the ids were ever actually different projects.

## Acceptance Criteria
- [ ] Root cause confirmed via live reproduction on mobile staging (not just code-reading)
- [ ] A Focus export always lands the user on the `FocusPublishActionBar` preview screen when
      they're still in Focus for the exported project, matching desktop behavior
- [ ] If the legitimate "user navigated away mid-export" case still needs to skip the preview,
      that stays correct — this task fixes the FALSE early-return, not the real one
- [ ] Regression test reproducing the stale-selectedProjectId race (or whatever the confirmed
      cause turns out to be)
- [ ] Tests pass
