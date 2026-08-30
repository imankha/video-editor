# T8050: Focus mode briefly shows "No video loaded" instead of a loading state

**Status:** WIP
**Impact:** 5
**Complexity:** 2
**Created:** 2026-08-30 (reported live-testing the T8040 Focus button)

## Problem

Clicking the new T8040 "Focus" button (or the pre-existing Annotate -> Focus nav
tab / My-Reels "re-edit reel" open) briefly shows "No video loaded" for a couple
of seconds before the real video appears. It reads as broken, not loading.

## Root cause

`VideoPlayer.jsx`'s render chain is `videoUrl ? <video> : error ? ... : isLoading
? <spinner> : "No video loaded"` (line ~199-330) — this part was already correct.
`FocusModeView`/`FocusScreen` feed it `isLoading={isLoading || isProjectLoading}`
where `isProjectLoading = useProjectDataStore(state => state.isLoading)`.

The bug is upstream: the annotate-leaving gesture that fetches clips for Focus
(`App.jsx handleModeChange` and the Downloads-panel "re-edit reel" opener) both
call `useProjectDataStore.getState().invalidateClips(projectId)` fire-and-forget,
**without ever touching `projectDataStore.isLoading`**. `invalidateClips` ->
`fetchClips` only sets `clipsFetching` (a flag nobody reads — confirmed zero
other read sites). So for the entire window between FocusScreen mounting and
the clips fetch resolving, `selectedClip`/`videoUrl` are null AND both
`isLoading` and `isProjectLoading` are false — `VideoPlayer` falls through to
the final "No video loaded" branch instead of the spinner branch, until the
fetch resolves and `videoUrl` finally populates.

The OTHER project-open path (`useProjectLoader.loadProject`, used when opening
a reel from Drafts/Home) does NOT have this bug: it explicitly brackets its own
`fetchClips` call with `setLoading(true, 'clips')` / `setLoading(false)` at the
call site. `invalidateClips`'s callers just never adopted that pattern.

T8040 didn't introduce this hole (the reviewer flagged it as a pre-existing gap
during that review) but does substantially widen how often it's hit, since
opening Focus without a pre-selected project used to be rare.

## Fix

Bracket both `invalidateClips` call sites in `App.jsx` with the same
`setLoading(true, 'clips')` / `.finally(() => setLoading(false))` pattern
`useProjectLoader` already uses — reusing the existing signal FocusScreen
already reads and already has a "Loading clips..." message for
(`loadingStage === 'clips'`), rather than inventing a new one.

## Context

### Relevant Files
- `src/frontend/src/App.jsx` — both `invalidateClips` call sites
  (`handleModeChange`, `DownloadsPanel.onOpenProject`)
- `src/frontend/src/stores/projectDataStore.js` — `setLoading`/`isLoading`/
  `loadingStage` (unchanged, already correct)
- `src/frontend/src/components/VideoPlayer.jsx` — the render branch (unchanged,
  already correct)
- `src/frontend/src/screens/FocusScreen.jsx` / `src/frontend/src/modes/FocusModeView.jsx`
  — `isProjectLoading` read + message derivation (unchanged, already correct)

### Technical Notes
- `clipsFetching` (projectDataStore) is left as dead/unused — out of scope to
  remove here; noted for a future cleanup pass.
- Not adding a test to App.jsx directly (it has no existing unit-test harness,
  matching the T8040 finding for AnnotateScreen — these top-level screens rely
  on live/e2e verification). Verified live in a real browser instead.

## Progress Log

**2026-08-30**: Root-caused and fixed. Live-verified: clicking Focus on a clip
with an existing reel now shows the "Loading clips..." spinner immediately,
never the "No video loaded" empty state, until the video appears.
