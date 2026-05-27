# T3180: Action Breadcrumbs

**Epic:** [Bug Report Diagnostic Quality](EPIC.md)
**Status:** TODO
**Stack Layers:** Frontend
**Files Affected:** ~12-15 files
**LOC Estimate:** ~120 lines
**Test Scope:** None (manual verification)

## Problem

The breadcrumb system (`track()` in `src/frontend/src/utils/analytics.js`) only captures 8 event types:

| Event | Source | Signal |
|-------|--------|--------|
| `mode_change` | store subscription | High |
| `project_select` | store subscription | High |
| `game_select` | store subscription | High |
| `clip_select` | store subscription | High |
| `clip_add` | useAnnotate.js | High |
| `clip_delete` | useAnnotate.js | High |
| `export_started` | exportStore.js | High |
| `export_complete` | exportStore.js | High |

Missing: all video interactions, framing gestures, overlay interactions, rating changes, navigation events. For Bug #1, the breadcrumbs would have been nearly empty -- the user loaded a game, entered annotate, and added clips, but only `game_select`, `mode_change`, `clip_add` would show up. The video seek, rating changes, and clip reordering that might explain the bug would be invisible.

## Goal

Capture ~20 high-signal event types that reconstruct a user's session as a readable narrative. Each entry should answer: "what did the user do, and what was the relevant context?"

Buffer increased from 50 to 200 entries to cover longer sessions.

## Event Taxonomy

### Tier 1: Store subscriptions (add to `setupActionTracking()`)

These are centralized in `src/frontend/src/utils/analytics.js` and fire automatically on state changes:

| Event | Store | Fields | Why |
|-------|-------|--------|-----|
| `mode_change` | editorStore | from, to | Already exists |
| `project_select` | projectsStore | id | Already exists |
| `game_select` | gamesDataStore | id, name | Already exists |
| `clip_select` | projectDataStore | id | Already exists |
| `export_progress` | exportStore | type, status | NEW: track export start/complete/fail as store transitions |
| `video_state` | videoStore | isPlaying, currentTime | NEW: play/pause state changes |

**Implementation:** Add subscriptions in `setupActionTracking()` for `useExportStore` and `useVideoStore`. Track play/pause transitions (not every time update). For exports, watch the `activeExports` map for status changes.

### Tier 2: Gesture-level `track()` calls

These require adding `track()` calls in specific gesture handlers:

#### Annotate mode (`src/frontend/src/modes/annotate/`)

| Event | Handler/File | Fields | Why |
|-------|-------------|--------|-----|
| `clip_add` | useAnnotate.js `addClipRegion` | start, end, rating, seq | Already exists |
| `clip_delete` | useAnnotate.js `deleteClipRegion` | regionId | Already exists |
| `clip_rating` | useAnnotate.js `updateClipRegion` | regionId, rating | NEW: rating changes affect clip prioritization |
| `clip_trim` | useAnnotate.js `moveRegionStart/End` | regionId, start, end | NEW: boundary drags affect timeline positioning |
| `video_seek` | AnnotateControls.jsx or useVideo seek handler | from, to | NEW: where user scrubs to |

#### Framing mode (`src/frontend/src/modes/framing/`)

| Event | Handler/File | Fields | Why |
|-------|-------------|--------|-----|
| `crop_keyframe_add` | useCrop.js or FramingContainer | frame, clipId | NEW: keyframe operations are primary framing actions |
| `crop_keyframe_delete` | useCrop.js or FramingContainer | frame, clipId | NEW |
| `crop_change` | useCrop.js (gesture complete) | frame, x, y, w, h | NEW: what crop values were set |
| `segment_add` | FramingContainer/FramingTimeline | time, clipId | NEW: segment splits |
| `aspect_ratio_change` | projectDataStore or useClipManager | from, to | NEW: affects all crop calculations |

#### Overlay mode (`src/frontend/src/modes/overlay/`)

| Event | Handler/File | Fields | Why |
|-------|-------------|--------|-----|
| `overlay_effect_change` | overlayStore or OverlayContainer | from, to | NEW: effect type changes |
| `highlight_region_add` | OverlayContainer | regionIndex | NEW |
| `highlight_region_delete` | OverlayContainer | regionIndex | NEW |
| `overlay_settings_change` | overlayStore setters | field, value | NEW: shape/color/stroke changes (batch as one event type) |

#### General

| Event | Handler/File | Fields | Why |
|-------|-------------|--------|-----|
| `login` | authStore | (none) | Already exists |
| `share_initiated` | various | method, source | Already exists |

### Total: ~22 event types

## Buffer Size

Change `MAX_ENTRIES` from 50 to 200 in `src/frontend/src/utils/analytics.js`:

```javascript
const MAX_ENTRIES = 200;
```

At 200 entries with ~22 event types, the buffer covers approximately:
- Light usage (annotate, few clips): 30+ minutes of session
- Heavy usage (framing, many keyframes): 10-15 minutes of session
- This is sufficient — most bug reports happen within minutes of the issue

## Implementation Notes

### Where to add `track()` calls

Each `track()` call goes in the **gesture handler** (the function that fires from user interaction), not in a store setter or effect. This follows the codebase's persistence model: gesture → action.

Example for `clip_rating`:
```javascript
// In useAnnotate.js, inside updateClipRegion or wherever rating is changed:
track('clip_rating', { regionId, rating }, { debugOnly: true });
```

All new breadcrumb events use `{ debugOnly: true }` — they buffer locally for bug reports but do NOT send to Cloudflare Analytics (those events are reserved for business metrics).

### Finding the right handlers

The implementing agent should:
1. Search for the store action or handler named in the "Handler/File" column
2. Add the `track()` call at the point where the user gesture is confirmed (after validation, before state update)
3. Include only the fields listed — no large objects, no PII

### Video seek tracking

Video seeks happen frequently during annotation. To avoid flooding the buffer, only track seeks that jump more than 5 seconds (skip frame-stepping):

```javascript
if (Math.abs(newTime - prevTime) > 5) {
  track('video_seek', { from: round1(prevTime), to: round1(newTime) }, { debugOnly: true });
}
```

## Files to Modify

1. **`src/frontend/src/utils/analytics.js`** — Increase MAX_ENTRIES, add store subscriptions for video/export
2. **`src/frontend/src/modes/annotate/hooks/useAnnotate.js`** — Add clip_rating, clip_trim events
3. **`src/frontend/src/modes/framing/`** — Add crop_keyframe_add/delete, crop_change, segment_add. Find the gesture handlers (likely in a Container or useCrop hook).
4. **`src/frontend/src/modes/overlay/`** — Add overlay_effect_change, highlight_region_add/delete, settings_change. Find the gesture handlers (likely in OverlayContainer or OverlayMode).
5. **`src/frontend/src/stores/projectDataStore.js`** or useClipManager — Add aspect_ratio_change if not already captured via store subscription
6. **Various annotate/framing controls** — Add video_seek with the 5-second threshold

## Dependencies

- Depends on T3150 (backend NULL fix) — without it, an empty actions array would be stored as NULL.
- The existing `track()` infrastructure and `setupActionTracking()` are already in HEAD (commit `05c8b07d`). This task extends them.
- Independent of T3160 (screenshot) and T3170 (editor context).
