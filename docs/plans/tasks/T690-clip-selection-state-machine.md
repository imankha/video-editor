# T690: Clip Selection & Edit Mode State Machine

**Status:** TODO
**Impact:** 7
**Complexity:** 5
**Created:** 2026-03-23
**Updated:** 2026-03-23

## Problem

The clip selection and edit mode system has grown through incremental patches into a fragile mess of special-case code. Symptoms:

- "Edit Clip" button shows when it shouldn't (playhead not on clip)
- Clip selection doesn't persist across fullscreen toggle
- Edit overlay doesn't load clip values (name, tags) correctly
- Auto-deselect races with async `seek()` causing selection to flicker
- `currentTime` state is stale when paused, causing incorrect deselect decisions
- Multiple competing mechanisms: auto-select effect, user select handler, overlay close handler, fullscreen toggle handler — all fighting over selection state

**Root cause:** Selection state is managed reactively through effects that trigger on `currentTime` changes, but `currentTime` updates are async (tied to video element events). This creates race conditions where effects make decisions based on stale data.

## Requirements

### Selection Rules
1. A clip is **selected** when:
   - User clicks a clip in the sidebar → select + seek to clip start
   - Playhead enters a clip's `[startTime, endTime]` range during playback
2. A clip is **deselected** when:
   - Playhead moves outside the selected clip's `[startTime, endTime]` range (scrub, playback, or seek)
   - User clicks a different clip
   - There is no clip at the current playhead position and no user-initiated selection is pending
3. Selection must survive fullscreen toggle without flickering

### Edit Mode Rules (Button)
4. **Non-fullscreen:** The Add/Edit Clip button is hidden when a clip is selected (Clip Details sidebar is the editing interface)
5. **Fullscreen:** Button shows "Edit Clip" (amber) when a clip is selected, "Add Clip" (green) when no clip is selected
6. **Fullscreen + playing:** "Edit Clip" stays visible during playback; "Add Clip" only shows when paused
7. Button is always hidden while the overlay dialog is open

### Edit Overlay Rules
8. Entering fullscreen with a selected clip → open Edit Clip overlay automatically
9. Leaving fullscreen → close the overlay (sidebar takes over)
10. Overlay loads ALL fields from the selected clip: name, rating, tags, notes, startTime, endTime
11. Selecting a different clip while overlay is open → overlay reloads with new clip's data
12. Closing the overlay does NOT deselect the clip

### Seek Responsiveness
13. `setCurrentTime` should update optimistically in `seek()` so UI responds instantly (playhead, timestamp, selection effects). The `seeked` event refines the value after the browser loads the frame.

## Solution

Design a **state machine** for clip selection rather than reactive effects:

```
States: NONE | SELECTED(clipId) | EDITING(clipId)

Transitions:
  NONE + user_click_clip(id)     → SELECTED(id)  [seek to startTime]
  NONE + playhead_enters_clip(id)→ SELECTED(id)
  SELECTED(id) + playhead_leaves → NONE
  SELECTED(id) + user_click_edit → EDITING(id)   [open overlay]
  SELECTED(id) + enter_fullscreen→ EDITING(id)   [open overlay]
  SELECTED(id) + user_click_clip(other) → SELECTED(other) [seek]
  EDITING(id) + close_overlay    → SELECTED(id)  [stay selected]
  EDITING(id) + exit_fullscreen  → SELECTED(id)  [close overlay]
  EDITING(id) + select_clip(other)→ EDITING(other) [reload overlay]
  ANY + playhead_leaves_clip     → NONE           [close overlay if open]
```

Key design decisions:
- **No cooldown timers.** The seek-is-async problem should be solved by updating `currentTime` optimistically, not by suppressing effects with timeouts.
- **Single source of truth.** One piece of state (`selectionState`) drives all UI. No separate `isEditMode`, `showAnnotateOverlay`, `annotateSelectedRegionId` computed independently.
- **Views reflect state.** The button text, overlay visibility, sidebar highlight — all derived from `selectionState`. No imperative show/hide calls scattered across handlers.

## Context

### Relevant Files
- `src/frontend/src/containers/AnnotateContainer.jsx` — Selection handlers, auto-select effect, overlay open/close
- `src/frontend/src/modes/AnnotateModeView.jsx` — `isEditMode` prop, `frozenExistingClipRef`, `onAddClip` conditional
- `src/frontend/src/modes/annotate/components/AnnotateControls.jsx` — Add/Edit button visibility logic
- `src/frontend/src/modes/annotate/components/AnnotateFullscreenOverlay.jsx` — Overlay form population from `existingClip`
- `src/frontend/src/hooks/useVideo.js` — `seek()` function, `currentTime` state updates
- `src/frontend/src/modes/annotate/hooks/useAnnotate.js` — `selectRegion`, `getRegionAtTime`

### Related Tasks
- Depends on: None
- Blocks: None

### Technical Notes
- The `frozenExistingClipRef` pattern exists because scrub handles seek the playhead in/out of clip regions, which would toggle `existingClip` and reset the form. The state machine approach should handle this by keeping `EDITING` state stable during scrub.
- `currentTime` from React state can be stale when the video is paused. The optimistic seek fix (setting `currentTime` in `seek()` before `seeked` event) is essential for correct selection behavior.

## Acceptance Criteria

- [ ] Selecting a clip in sidebar highlights it and seeks to start
- [ ] Playhead leaving clip range deselects (during playback or scrub)
- [ ] Selection survives fullscreen toggle without flicker
- [ ] Edit Clip button: hidden in non-fullscreen when selected, visible in fullscreen during playback
- [ ] Overlay loads all clip fields (name, rating, tags, notes, times)
- [ ] Overlay reloads when selecting a different clip
- [ ] Closing overlay keeps clip selected
- [ ] No timer-based workarounds
- [ ] Seek updates UI instantly (optimistic currentTime)
