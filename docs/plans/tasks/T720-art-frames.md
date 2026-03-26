# T720: Art Frames — Pen Drawing on Clip Freeze Frames

**Status:** TODO
**Impact:** 8
**Complexity:** 7
**Created:** 2026-03-25
**Updated:** 2026-03-25

## Problem

Coaches and players want to annotate specific moments visually — draw arrows pointing to positioning errors, circle open players, highlight passing lanes. Currently the only annotation tools are text-based (name, rating, notes). There's no way to mark up the actual video frame, which is the most natural way to explain what happened in a play.

## Solution

**Art Frames** — when paused on a clip in annotate mode, the user can enter a drawing mode and use a pen tool to draw directly on the frozen video frame. During "Play Annotations" playback, when the playhead reaches a clip with an art frame, playback pauses on that frame for a configurable duration (default 3s, range 1–10s) and displays the pen strokes overlaid on the video.

### Core Concepts

1. **Drawing Mode**: Activated from the clip edit overlay or a toolbar button while paused on a clip. The video frame freezes and a transparent canvas overlays it. The user draws with a pen tool (configurable color, thickness). Strokes are saved to the clip's data.

2. **Compact Storage**: Pen strokes stored as an array of polylines. Each polyline is `{ color, width, points }` where `points` is a flat array of normalized coordinates `[x1, y1, x2, y2, ...]` (0–1 range, relative to video dimensions). This is resolution-independent and compact.

3. **Playback Integration**: During Play Annotations, the virtual timeline engine recognizes clips with art frames. When reaching such a clip, playback pauses at the art frame's timestamp, renders the pen strokes on a canvas overlay, holds for the configured duration, then resumes.

### Two Phases

**Phase 1: Drawing + Storage**
- Pen tool with color picker (preset palette) and thickness slider (1–5px range)
- Undo/redo for strokes
- Clear all button
- Canvas overlay on frozen video frame
- Storage as normalized polylines in clip data (`artFrame` field)
- Art frame indicator on clip list items (small icon)

**Phase 2: Playback Integration**
- Virtual timeline recognizes art frame clips
- Configurable pause duration (1–10s, default 3s) — global setting in PlaybackControls
- Canvas overlay renders stored strokes during pause
- Smooth transition: play clip → freeze at art frame time → show strokes → resume

## Technical Approach

### Data Model

```javascript
// Added to clip region data
artFrame: {
  timestamp: number,      // Actual video time where the frame was captured
  strokes: [
    {
      color: '#FF0000',   // Hex color
      width: 2,           // Stroke width in normalized units (relative to video width)
      points: [0.1, 0.2, 0.15, 0.25, 0.2, 0.3, ...]  // Flat [x, y, x, y, ...] normalized 0–1
    }
  ],
  pauseDuration: null,    // Per-clip override (null = use global default)
}
```

**Why normalized coordinates:** Resolution-independent. A stroke at `(0.5, 0.5)` is always center-screen regardless of video resolution, player size, or fullscreen state. The rendering canvas scales to the video element's displayed size.

**Why flat arrays:** `[x1, y1, x2, y2, ...]` is ~50% smaller than `[{x, y}, {x, y}, ...]` when serialized to JSON. For a typical annotation with 5 strokes averaging 50 points each, this saves ~2KB per clip.

### Drawing Canvas

- HTML5 `<canvas>` overlay positioned on top of the frozen video frame
- `pointer-events: auto` during drawing, `none` during playback display
- Canvas resolution matches video element display size (CSS pixels × devicePixelRatio for crisp lines)
- Stroke capture: `pointerdown` → start polyline, `pointermove` → append points, `pointerup` → finalize stroke
- Coordinates normalized on capture: `(clientX - canvasRect.left) / canvasRect.width`

### Backend Storage

- `artFrame` stored as JSON in the clip's data (same as notes, tags, etc.)
- Sent via existing `updateClipRegion` → `useRawClipSave` pipeline
- No new API endpoints needed — art frame data piggybacks on clip updates

### Playback Integration (Phase 2)

- `useVirtualTimeline` gains awareness of art frame segments: a clip with an art frame generates two sub-segments: `[startTime, artFrameTime]` at normal playback rate, then `[artFrameTime, artFrameTime + pauseDuration]` as a freeze frame
- During the freeze segment, the video is paused and a read-only canvas renders the strokes
- After the pause duration elapses, playback resumes from `artFrameTime` to `endTime`

## UI Design

### Drawing Mode

```
┌──────────────────────────────────────────┐
│          Frozen Video Frame              │
│     ╱─────→  (user drawing arrows)       │
│    ○        ╲                            │
│   player     ╲  target                   │
│                                          │
│  ┌─────────────────────────────┐         │
│  │ 🖊 ● Red  ○ Blue  ○ White   │  ← palette│
│  │ Thickness: ━━━●━━━          │         │
│  │ [Undo] [Redo] [Clear]      │         │
│  │ [Save Art Frame] [Cancel]  │         │
│  └─────────────────────────────┘         │
└──────────────────────────────────────────┘
```

### Clip List Indicator

Clips with art frames show a small pen/brush icon next to the rating badge.

### Playback Controls

Global art frame pause duration control in PlaybackControls:
```
[Art Frame: 3s ▾]   ← dropdown or slider (1–10s)
```

## Context

### Relevant Files (REQUIRED)

**Frontend — will change:**
- `src/frontend/src/modes/annotate/components/AnnotateFullscreenOverlay.jsx` — Add "Draw Art Frame" button to clip edit overlay
- `src/frontend/src/modes/annotate/hooks/useAnnotate.js` — Add `artFrame` field to clip data model
- `src/frontend/src/modes/annotate/components/ClipListItem.jsx` — Art frame indicator icon
- `src/frontend/src/modes/annotate/hooks/useAnnotationPlayback.js` — Art frame pause logic during playback
- `src/frontend/src/modes/annotate/hooks/useVirtualTimeline.js` — Art frame sub-segments
- `src/frontend/src/modes/annotate/components/PlaybackControls.jsx` — Global pause duration control

**Frontend — new files:**
- `src/frontend/src/modes/annotate/components/ArtFrameCanvas.jsx` — Drawing canvas overlay (pen tool, stroke capture, rendering)
- `src/frontend/src/modes/annotate/hooks/useArtFrame.js` — Drawing state (strokes, undo/redo, color, thickness)

**Frontend — reference:**
- `src/frontend/src/modes/annotate/components/NotesOverlay.jsx` — Overlay positioning pattern
- `src/frontend/src/components/VideoPlayer.jsx` — Video element overlay integration

**Backend — minimal changes:**
- `src/backend/app/routers/clips.py` — Ensure `art_frame` JSON field passes through on clip updates (likely no change needed if using flexible JSON storage)

### Code Context — Annotate Mode Architecture

**Component hierarchy:**
```
AnnotateScreen (src/frontend/src/screens/AnnotateScreen.jsx)
  ├── useVideo() — video playback (videoRef, seek, play, pause, currentTime)
  ├── useZoom() — zoom/pan state
  └── AnnotateContainer (src/frontend/src/containers/AnnotateContainer.jsx)
        ├── useAnnotateState() — video URL, metadata, playback speed, fullscreen
        ├── useAnnotate() — clip regions array, add/update/delete, getRegionAtTime
        ├── useClipSelection() — state machine (NONE→SELECTED→EDITING→CREATING)
        ├── useRawClipSave() — backend persistence (saveClip, updateClip, deleteClip)
        ├── useAnnotationPlayback() — T710 dual-video ping-pong controller
        └── AnnotateModeView (src/frontend/src/modes/AnnotateModeView.jsx)
              ├── VideoPlayer — single video with overlays (annotate mode)
              │   ├── NotesOverlay — clip name/rating/notes overlay
              │   └── AnnotateFullscreenOverlay — clip create/edit panel
              ├── AnnotateControls — play/pause/step/speed/volume/fullscreen
              ├── AnnotateMode/Timeline — timeline with clip regions
              └── [PLAYBACK MODE] — dual video elements + PlaybackControls
```

**Clip data model (useAnnotate.js):**
```javascript
clipRegion = {
  id: string,              // Local unique ID
  rawClipId: number|null,  // Backend raw_clips table ID
  startTime: number,       // seconds
  endTime: number,         // seconds
  name: string,
  rating: 1-5,
  tags: string[],
  notes: string,           // max 280 chars, shown in NotesOverlay
  videoSequence: number|null,  // T82 multi-video
  color: string,           // auto-assigned hex
  // T720: artFrame will be added here
}
```

**Key functions in useAnnotate.js:**
- `addClipRegion(startTime, duration, notes, rating, position, tags, name, videoSequence)` — creates clip
- `updateClipRegion(regionId, updates)` — partial update, triggers re-render
- `getRegionAtTime(time)` — returns clip at playhead position
- `getExportData()` — serializes clips with snake_case for backend

**Clip selection state machine (useClipSelection.js):**
```
NONE → selectClip(id) → SELECTED
SELECTED → editClip(id) → EDITING (overlay opens)
NONE → startCreating() → CREATING (overlay opens)
EDITING/CREATING → closeOverlay() → SELECTED or NONE
```
Drawing mode would be a new state or entered from EDITING.

**Backend persistence (AnnotateContainer.jsx → useRawClipSave):**
- `updateClipRegionWithSync(regionId, updates)` — updates locally + syncs to backend
- Backend fields: `start_time, end_time, name, rating, tags, notes, video_sequence`
- Art frame data would be added as a new JSON field (e.g., `art_frame`)

**AnnotateFullscreenOverlay.jsx** — The clip edit panel that appears when creating/editing a clip. This is where the "Draw Art Frame" button would go. It receives `existingClip`, `currentTime`, `videoDuration`, and handlers for create/update.

### Code Context — Playback Mode Architecture (T710)

**Playback hook (useAnnotationPlayback.js):**
```javascript
// Dual <video> elements: videoARef, videoBRef
// Only one visible at a time via CSS opacity swap (80ms crossfade)

// Core state:
isPlaybackMode, isPlaying, virtualTime, activeClipId, playbackRate

// Key functions:
enterPlaybackMode()     // Builds timeline, loads video A, auto-plays
exitPlaybackMode()      // Pauses both, resets state
togglePlay()            // Play/pause with restart-from-end support
seekVirtual(vt)         // Seek by virtual time (may cross segments)
seekWithinSegment(at)   // Seek within current clip (frame-level, for scrub bar)
startScrub() / endScrub() // Pause during drag, resume after
changePlaybackRate(rate)   // Updates active video element immediately

// RAF loop (startTimeUpdateLoop):
// - Reads active.currentTime, converts to virtualTime
// - Preloads next segment when approaching end
// - At segment boundary: swap videos, play preloaded, preload next
// - Batches React state updates during scrub (scheduleScrubStateUpdate)
```

**Virtual timeline engine (useVirtualTimeline.js):**
```javascript
buildVirtualTimeline(clips) → {
  segments: [{ clipId, startTime, endTime, videoSequence, virtualStart, virtualEnd, duration }],
  totalVirtualDuration: number,
  virtualToActual(vt) → { segmentIndex, actualTime, segment },
  actualToVirtual(segIndex, actualTime) → virtualTime,
  getSegmentAtVirtualTime(vt) → { segment, segmentIndex },
}
```
Art frames would add sub-segments: for a clip with an art frame at time T, the clip generates `[startTime→T]` (normal playback) + `[T→T (freeze for N seconds)]` + `[T→endTime]` (resume).

**PlaybackControls.jsx:**
- Main timeline bar (drag-to-scrub across all clips)
- Clip scrub bar (drag within current clip for frame-level control)
- Transport: Back, Play/Pause, Restart
- Right controls: Volume+slider, Speed dropdown, Fullscreen
- Art frame pause duration control would go here

**NotesOverlay.jsx** — Displays clip name/rating/notes as white box overlay at top of video. Currently shows during both annotate and playback modes. Art frame strokes would render on a separate canvas layer (not in NotesOverlay).

**Video element structure in playback mode (AnnotateModeView.jsx):**
```jsx
<div className="relative bg-gray-900 rounded-lg overflow-hidden">
  <div className="relative h-[40vh] sm:h-[60vh]">
    <video ref={videoARef} style={{ opacity: activeLabel==='A' ? 1 : 0 }} />
    <video ref={videoBRef} style={{ opacity: activeLabel==='B' ? 1 : 0 }} />
    {/* Loading overlay */}
    {/* NotesOverlay */}
    {/* ArtFrameCanvas would go here — positioned absolute over video */}
  </div>
</div>
```

### Related Tasks
- Depends on: T710 (Play Annotations Mode — provides the playback infrastructure)
- Enhances: T650 (Clip Scrub Region — drawing happens on a specific frame within a clip)

## Acceptance Criteria

- [ ] User can enter drawing mode when paused on a clip
- [ ] Pen tool with color selection (at least 5 colors) and thickness control
- [ ] Undo/redo works for individual strokes
- [ ] Clear all removes all strokes
- [ ] Art frame data persists across page reloads (saved to backend)
- [ ] Clip list shows indicator for clips with art frames
- [ ] Art frame data stored as normalized coordinates (resolution-independent)
- [ ] During Play Annotations, clips with art frames pause and display strokes
- [ ] Pause duration configurable (1–10s, default 3s)
- [ ] Drawing renders correctly at all video sizes and in fullscreen
