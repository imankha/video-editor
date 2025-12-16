# Phase B: Clipify Mode

**Status**: PLANNED (After Phase A)
**Priority**: MEDIUM
**Scope**: New workflow mode for extracting clips from full game footage

---

## Overview

Clipify Mode introduces a new pre-framing workflow where users can extract individual clips from full-length game footage. Instead of importing pre-cut clips, users can import an entire game video and identify the moments they want to turn into highlight clips.

---

## Workflow Position

```
Current Flow:
  [Add Clips] → Framing → Overlay → Export

New Flow:
  [Add Clips] → Framing → Overlay → Export
       OR
  [Add Game] → Clipify → Export Clips → Framing (with clips) → Overlay → Export
```

---

## UI Entry Point

### No Videos State (Updated)

Currently, the "no videos" state shows an "Add" button. This will be updated:

```
Current:
┌─────────────────────────────────────────┐
│                                         │
│              [Add]                      │
│                                         │
│     Drop video files here or click      │
└─────────────────────────────────────────┘

New:
┌─────────────────────────────────────────────────┐
│                                                 │
│        [Add Clips]        [Add Game]           │
│                                                 │
│  Drop clip files or         Import full game   │
│  click to browse            to extract clips   │
└─────────────────────────────────────────────────┘
```

### Button Behavior

| Button | Action |
|--------|--------|
| **Add Clips** | Opens file picker, imports videos directly to Framing mode (existing behavior) |
| **Add Game** | Opens file picker, imports single video into Clipify mode |

---

## Clipify Mode Interface

### Main Layout

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Mode: Clipify                                              [Exit Mode]  │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │                                                                    │ │
│  │                     Video Preview                                  │ │
│  │                     (Full Game)                                    │ │
│  │                                                                    │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │ Clip List                                      [+ Add Clip Region] │ │
│  │ ┌──────────────────────────────────────────────────────────────┐   │ │
│  │ │ Clip 1: 00:02:30 - 00:02:38 (8s)               [x] [Edit]   │   │ │
│  │ │ "Amazing dribble past 3 defenders"                          │   │ │
│  │ └──────────────────────────────────────────────────────────────┘   │ │
│  │ ┌──────────────────────────────────────────────────────────────┐   │ │
│  │ │ Clip 2: 00:15:42 - 00:15:50 (8s)               [x] [Edit]   │   │ │
│  │ │ "Through ball assist"                                       │   │ │
│  │ └──────────────────────────────────────────────────────────────┘   │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │ Timeline                                                          │ │
│  │ [====================|===|================|====|==================] │
│  │                      ▲                    ▲                         │
│  │                    Clip 1               Clip 2                      │
│  │ 00:00:00                                              01:30:00      │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
│                    [Export Clips] → Proceeds to Framing                 │
└──────────────────────────────────────────────────────────────────────────┘
```

### Clip Region Editor

When editing a clip region:

```
┌─────────────────────────────────────────────────────────────────┐
│ Edit Clip Region                                          [x]  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │                 Video Preview                              │ │
│  │                 (Shows clip region)                        │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
│  Start: [00:02:30]  End: [00:02:38]  Duration: 8s              │
│                                                                 │
│  Timeline (zoomed to clip):                                    │
│  [●━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━●] │
│   ▲ Start lever                               End lever ▲      │
│                                                                 │
│  Description:                                                  │
│  [Amazing dribble past 3 defenders_______________]             │
│                                                                 │
│                              [Save] [Cancel]                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Data Model

### Clipify State

```typescript
interface ClipifyState {
  sourceVideo: {
    file: File;
    path: string;
    duration: number;
    dimensions: { width: number; height: number };
    framerate: number;
  };
  clipRegions: ClipRegion[];
  activeRegionId: string | null;
}

interface ClipRegion {
  id: string;
  startTime: number;      // seconds
  endTime: number;        // seconds
  description: string;    // user-provided description
  color: string;          // region display color
  createdAt: Date;
}
```

### Exported Clip Metadata

```typescript
interface ExportedClipMetadata {
  originalVideo: string;      // Original filename
  startTime: number;          // Start time in original video
  endTime: number;            // End time in original video
  description: string;        // User description
  exportedAt: string;         // ISO timestamp
}
```

---

## Export Process

### File Naming Convention

```
{original_video_name}_{start_timestamp}_{end_timestamp}.mp4

Examples:
  soccer_game_2024.mp4 →
    soccer_game_2024_00m02s30_00m02s38.mp4
    soccer_game_2024_00m15s42_00m15s50.mp4
```

### Metadata Embedding

Clip descriptions are embedded in the video file metadata using FFmpeg:

```bash
ffmpeg -i input.mp4 \
  -ss 00:02:30 -to 00:02:38 \
  -metadata description="Amazing dribble past 3 defenders" \
  -metadata original_video="soccer_game_2024.mp4" \
  -metadata clip_start="00:02:30" \
  -metadata clip_end="00:02:38" \
  -c copy \
  output.mp4
```

### Post-Export Flow

After export completes:
1. Clips are saved to user-selected output folder
2. User is prompted: "Load clips into Framing mode?"
3. If yes, clips are automatically imported into Framing mode
4. Clip metadata (description) is visible in the clip list

---

## Implementation Tasks

### Task 1: Update No-Videos State UI
**Estimated Effort**: Small
**Files to Modify**:
- [App.jsx](src/frontend/src/App.jsx) - No videos state rendering

**Testable Outcome**:
- [ ] Two buttons visible: "Add Clips" and "Add Game"
- [ ] "Add Clips" works same as current "Add"
- [ ] "Add Game" opens file picker

---

### Task 2: Add Clipify Mode State
**Estimated Effort**: Medium
**Files to Create/Modify**:
- Create: `src/frontend/src/modes/clipify/hooks/useClipify.js`
- Modify: [App.jsx](src/frontend/src/App.jsx)

**Testable Outcome**:
- [ ] App tracks `editorMode: 'clipify'`
- [ ] Source video state stored
- [ ] Clip regions array managed

---

### Task 3: Create Clipify Mode Container
**Estimated Effort**: Medium
**Files to Create**:
- Create: `src/frontend/src/modes/clipify/ClipifyMode.jsx`
- Create: `src/frontend/src/modes/clipify/index.js`

**Testable Outcome**:
- [ ] Clipify mode renders when game video added
- [ ] Video preview shows full game
- [ ] Basic layout visible

---

### Task 4: Create Clip List Component
**Estimated Effort**: Medium
**Files to Create**:
- Create: `src/frontend/src/modes/clipify/components/ClipList.jsx`
- Create: `src/frontend/src/modes/clipify/components/ClipListItem.jsx`

**Testable Outcome**:
- [ ] Clip list renders defined regions
- [ ] Shows start time, end time, duration
- [ ] Shows description
- [ ] Edit and delete buttons visible

---

### Task 5: Create Clipify Timeline
**Estimated Effort**: Medium
**Files to Create**:
- Create: `src/frontend/src/modes/clipify/ClipifyTimeline.jsx`
- Create: `src/frontend/src/modes/clipify/layers/ClipRegionLayer.jsx`

**Testable Outcome**:
- [ ] Full video duration shown on timeline
- [ ] Clip regions displayed as highlighted sections
- [ ] Playhead shows current position
- [ ] Can click to seek

---

### Task 6: Add Clip Region Creation
**Estimated Effort**: Small
**Files to Modify**:
- [ClipifyMode.jsx](src/frontend/src/modes/clipify/ClipifyMode.jsx)
- [useClipify.js](src/frontend/src/modes/clipify/hooks/useClipify.js)

**Testable Outcome**:
- [ ] "Add Clip Region" button visible
- [ ] Click creates new region at current playhead
- [ ] Default duration: 10 seconds
- [ ] New region appears in list and timeline

---

### Task 7: Create Clip Region Editor Dialog
**Estimated Effort**: Medium
**Files to Create**:
- Create: `src/frontend/src/modes/clipify/components/ClipRegionEditor.jsx`

**Testable Outcome**:
- [ ] Click "Edit" on clip opens editor dialog
- [ ] Video preview shows clip portion
- [ ] Start/end time inputs editable
- [ ] Description text input available

---

### Task 8: Implement Region Levers
**Estimated Effort**: Medium
**Files to Modify**:
- [ClipRegionEditor.jsx](src/frontend/src/modes/clipify/components/ClipRegionEditor.jsx)
- [ClipifyTimeline.jsx](src/frontend/src/modes/clipify/ClipifyTimeline.jsx)

**Testable Outcome**:
- [ ] Drag left lever to adjust start time
- [ ] Drag right lever to adjust end time
- [ ] Duration updates in real-time
- [ ] Video preview updates to show adjusted region

---

### Task 9: Create Clips Export Backend Endpoint
**Estimated Effort**: Medium
**Files to Create/Modify**:
- Create: `src/backend/app/routers/clipify.py`
- Modify: `src/backend/app/main.py` (register router)

**API Contract**:
```
POST /clipify/export
Request: {
  video_path: string,
  output_folder: string,
  clips: [{
    start_time: float,
    end_time: float,
    description: string
  }]
}
Response: {
  exported_clips: [{
    filename: string,
    path: string,
    duration: float
  }]
}
```

**Testable Outcome**:
- [ ] Call endpoint with clip definitions
- [ ] Clips created in output folder
- [ ] Filenames follow naming convention
- [ ] Metadata embedded in files

---

### Task 10: Implement Frontend Export Flow
**Estimated Effort**: Medium
**Files to Create/Modify**:
- Create: `src/frontend/src/modes/clipify/components/ClipifyExportButton.jsx`
- Modify: [ClipifyMode.jsx](src/frontend/src/modes/clipify/ClipifyMode.jsx)

**Testable Outcome**:
- [ ] "Export Clips" button visible
- [ ] Click shows folder picker dialog
- [ ] Progress shown during export
- [ ] Success message on completion

---

### Task 11: Auto-Load Clips to Framing Mode
**Estimated Effort**: Medium
**Files to Modify**:
- [App.jsx](src/frontend/src/App.jsx)
- [useClipManager.js](src/frontend/src/hooks/useClipManager.js)

**Testable Outcome**:
- [ ] After export, prompt appears "Load into Framing?"
- [ ] Click "Yes" transitions to Framing mode
- [ ] Exported clips are loaded automatically
- [ ] Clips appear in clip list

---

### Task 12: Display Clip Metadata in Framing
**Estimated Effort**: Small
**Files to Modify**:
- [useClipManager.js](src/frontend/src/hooks/useClipManager.js)
- Clip list UI component (if exists)

**Testable Outcome**:
- [ ] Clip description visible in clip list
- [ ] Original video source shown
- [ ] Original timestamps shown

---

### Task 13: Delete Clip Region
**Estimated Effort**: Small
**Files to Modify**:
- [ClipList.jsx](src/frontend/src/modes/clipify/components/ClipList.jsx)
- [useClipify.js](src/frontend/src/modes/clipify/hooks/useClipify.js)

**Testable Outcome**:
- [ ] Click delete (x) on clip region
- [ ] Confirmation dialog appears
- [ ] Clip removed from list and timeline

---

### Task 14: Exit Clipify Mode
**Estimated Effort**: Small
**Files to Modify**:
- [ClipifyMode.jsx](src/frontend/src/modes/clipify/ClipifyMode.jsx)
- [App.jsx](src/frontend/src/App.jsx)

**Testable Outcome**:
- [ ] "Exit Mode" button visible
- [ ] Click returns to no-videos state
- [ ] Unsaved changes warning if clips defined

---

## Files Summary

### Files to Create

| File | Purpose |
|------|---------|
| `src/frontend/src/modes/clipify/ClipifyMode.jsx` | Main clipify mode container |
| `src/frontend/src/modes/clipify/index.js` | Mode exports |
| `src/frontend/src/modes/clipify/hooks/useClipify.js` | Clipify state management |
| `src/frontend/src/modes/clipify/ClipifyTimeline.jsx` | Timeline for full video |
| `src/frontend/src/modes/clipify/layers/ClipRegionLayer.jsx` | Clip regions on timeline |
| `src/frontend/src/modes/clipify/components/ClipList.jsx` | List of defined clips |
| `src/frontend/src/modes/clipify/components/ClipListItem.jsx` | Individual clip in list |
| `src/frontend/src/modes/clipify/components/ClipRegionEditor.jsx` | Edit clip dialog |
| `src/frontend/src/modes/clipify/components/ClipifyExportButton.jsx` | Export action button |
| `src/backend/app/routers/clipify.py` | Clipify export endpoint |

### Files to Modify

| File | Changes |
|------|---------|
| `src/frontend/src/App.jsx` | Add clipify mode state, update no-videos UI |
| `src/frontend/src/hooks/useClipManager.js` | Support clip metadata, auto-load from clipify |
| `src/backend/app/main.py` | Register clipify router |

---

## UI/UX Considerations

### Color Coding

| Element | Color |
|---------|-------|
| Clip region (timeline) | Blue highlight |
| Active clip region | Brighter blue with border |
| Start lever | Green |
| End lever | Red |
| Exported clip | Gray (dimmed) |

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `N` | Add new clip region at playhead |
| `Delete` | Delete selected clip region |
| `Enter` | Open editor for selected clip |
| `Escape` | Close editor dialog |
| `[` | Move playhead to region start |
| `]` | Move playhead to region end |

---

## Acceptance Criteria

### Entry Point
- [ ] "Add Game" button visible alongside "Add Clips"
- [ ] Clicking "Add Game" opens file picker
- [ ] Single video file imports into Clipify mode

### Clip Definition
- [ ] Can add clip regions at current playhead
- [ ] Can adjust start/end with region levers
- [ ] Can type description for each clip
- [ ] Clip list shows all defined clips
- [ ] Timeline shows clip regions visually

### Export
- [ ] Export creates individual clip files
- [ ] Files named with original video + timestamps
- [ ] Metadata (description) embedded in files
- [ ] Progress shown during export
- [ ] Success message on completion

### Transition to Framing
- [ ] Prompt to load clips after export
- [ ] Clips auto-load into Framing mode
- [ ] Clip metadata visible in Framing

### Edge Cases
- [ ] Overlapping clips: Show warning, allow anyway
- [ ] Very short clips (<1s): Show warning, allow anyway
- [ ] Very long clips (>60s): Show warning, allow anyway
- [ ] No clips defined: Export button disabled

---

## Future Enhancements (Not in Scope)

- AI-assisted clip detection (auto-find highlights)
- Waveform display for audio-based cutting
- Scene change detection
- Multi-select clips for batch operations
- Clip templates (preset durations)

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Large video files slow to load | Show loading progress, allow background loading |
| Export takes long time | Show per-clip progress, allow cancellation |
| User loses work on exit | Auto-save clip definitions, warn on exit |
| Clip boundaries off by frames | Use frame-accurate seeking, show frame numbers |
