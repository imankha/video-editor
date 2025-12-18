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
  [Add Raw Clips] → Framing → Overlay → Export
       OR
  [Add Overlay To Framed Video] → Overlay → Export (skip Framing)

New Flow (adds Clipify option):
  [Add Raw Clips] → Framing → Overlay → Export
       OR
  [Add Overlay To Framed Video] → Overlay → Export (skip Framing)
       OR
  [Add Game] → Clipify → Export → Framing (with clips) → Overlay → Export
                           ↓
                    (Annotated source video
                     downloads to client)
```

---

## UI Entry Point

### No Videos State (Updated)

Currently, the "no videos" state shows two buttons. A third button will be added for Clipify:

```
Current:
┌─────────────────────────────────────────────────────────────────────┐
│                                                                     │
│    [Add Raw Clips]          [Add Overlay To Framed Video]          │
│                                                                     │
│  Import clips for            Skip Framing, go directly             │
│  Framing mode                to Overlay mode                       │
└─────────────────────────────────────────────────────────────────────┘

New (adds third button):
┌─────────────────────────────────────────────────────────────────────────────────┐
│                                                                                 │
│  [Add Raw Clips]    [Add Overlay To Framed Video]    [Add Game]                │
│                                                                                 │
│  Import clips for    Skip Framing, go directly       Import full game          │
│  Framing mode        to Overlay mode                 to extract clips          │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Button Behavior

| Button | Action |
|--------|--------|
| **Add Raw Clips** | Opens file picker, imports videos directly to Framing mode (existing) |
| **Add Overlay To Framed Video** | Opens file picker, imports pre-framed video to Overlay mode (existing) |
| **Add Game** | Opens file picker, imports single video into Clipify mode (new) |

---

## Clipify Mode Interface

### Main Layout

The layout mirrors Framing mode with a **side panel** for clip management:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  Mode: Clipify                                                    [Exit Mode]   │
├────────────────────────────────────────────────────────┬────────────────────────┤
│                                                        │  Clips Panel           │
│  ┌──────────────────────────────────────────────────┐ │  ┌──────────────────┐  │
│  │                                                  │ │  │ [+ Add Clip]     │  │
│  │  ┌────────────────────────────────────────────┐ │ │  ├──────────────────┤  │
│  │  │  Notes overlay appears here during play   │ │ │  │ ● 00:02:30       │  │
│  │  │  (white bg, black text, top of video)     │ │ │  │   "Great dribble"│  │
│  │  └────────────────────────────────────────────┘ │ │  │   Notes: Pass 3  │  │
│  │                                                  │ │  │   defenders      │  │
│  │              Video Preview                       │ │  ├──────────────────┤  │
│  │              (Full Game)                         │ │  │ ○ 00:15:42       │  │
│  │                                                  │ │  │   "Through ball" │  │
│  │                                                  │ │  │   Notes: Assist  │  │
│  │                                                  │ │  │   to goal        │  │
│  └──────────────────────────────────────────────────┘ │  ├──────────────────┤  │
│                                                        │  │ ○ 00:32:15       │  │
│  ┌──────────────────────────────────────────────────┐ │  │   "Header goal"  │  │
│  │ Timeline (similar to Highlight regions)         │ │  │   Notes: Corner  │  │
│  │ [====|████|==========|████|========|████|======] │ │  │   kick header   │  │
│  │      ▲               ▲             ▲             │ │  └──────────────────┘  │
│  │    Clip 1          Clip 2        Clip 3          │ │                        │
│  │ 00:00:00                              01:30:00   │ │  [Export Clips]        │
│  └──────────────────────────────────────────────────┘ │                        │
└────────────────────────────────────────────────────────┴────────────────────────┘
```

### Clip Region Selection (Similar to Highlight Regions)

Clip regions are selected on the timeline using the **same UI pattern as highlight regions**:

1. **Adding a clip region**: Click "+ Add Clip" or press `N` - creates a region at current playhead
2. **Region appearance**: Colored bar on timeline with draggable start/end levers
3. **Selecting a region**: Click on region in timeline or side panel
4. **Adjusting duration**: Drag left/right levers on timeline (same as highlight region levers)

```
Timeline with clip regions:
┌────────────────────────────────────────────────────────────────────────────────┐
│  Video Track                                                                   │
│  [═══════════════════════════════════════════════════════════════════════════] │
├────────────────────────────────────────────────────────────────────────────────┤
│  Clip Regions Layer (similar to Highlight Layer)                               │
│  [────●━━━━━━━━━●────────●━━━━━━━━━━━●────────────●━━━━━━●──────────────────] │
│       ▲ start   ▲ end    ▲          ▲             ▲      ▲                     │
│       └─ Clip 1 ─┘       └─ Clip 2 ─┘             └Clip 3┘                     │
│                                                                                 │
│  ● = Draggable lever (same interaction as highlight region levers)             │
└────────────────────────────────────────────────────────────────────────────────┘
```

### Side Panel - Clip Details

When a clip is selected, the side panel shows editable details:

```
┌──────────────────────────────┐
│ Clip Details                 │
├──────────────────────────────┤
│ Name:                        │
│ [00:02:30_______________]    │  ← Default: timestamp, user can override
│                              │
│ Start: 00:02:30              │
│ End:   00:02:38              │
│ Duration: 8s                 │
│                              │
│ Notes:                       │
│ ┌──────────────────────────┐ │
│ │ Amazing dribble past 3   │ │  ← Multi-line text area
│ │ defenders, leads to      │ │
│ │ scoring opportunity      │ │
│ └──────────────────────────┘ │
│                              │
│ [Delete Clip]                │
└──────────────────────────────┘
```

### Notes Overlay During Playback

When the video is playing and the playhead enters a clip region, the **notes** for that clip appear as a text overlay at the **top of the video**:

```
┌──────────────────────────────────────────────────────────┐
│ ┌──────────────────────────────────────────────────────┐ │
│ │  Amazing dribble past 3 defenders, leads to scoring  │ │  ← White bg, black text
│ │  opportunity                                          │ │
│ └──────────────────────────────────────────────────────┘ │
│                                                          │
│                                                          │
│                    Video Content                         │
│                                                          │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

**Overlay behavior:**
- Appears when playhead enters a clip region
- Disappears when playhead exits the clip region
- Shows the **notes** field (not the name)
- Styling: White background, black text, top of video, 80% width centered, rounded corners
- Only visible during playback in Clipify mode (not exported)

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
  selectedRegionId: string | null;
}

interface ClipRegion {
  id: string;
  startTime: number;      // seconds
  endTime: number;        // seconds
  name: string;           // Default: formatted timestamp (e.g., "00:02:30"), user can override
  notes: string;          // User-provided notes (shown as overlay during playback)
  color: string;          // region display color (auto-assigned)
  createdAt: Date;
}
```

### Default Naming

When a clip is created:
- `name` defaults to the start timestamp formatted as `HH:MM:SS` (e.g., "00:02:30")
- `notes` defaults to empty string
- User can edit both in the side panel

### Exported Clip Metadata

```typescript
interface ExportedClipMetadata {
  originalVideo: string;      // Original filename
  startTime: number;          // Start time in original video
  endTime: number;            // End time in original video
  name: string;               // User-provided name (or timestamp default)
  notes: string;              // User notes
  exportedAt: string;         // ISO timestamp
}
```

---

## Export Process

Export produces **two outputs**:
1. **Raw clips** - Cut from source video, automatically forwarded to Framing mode
2. **Annotated source video** - Original video with all clip notes embedded in metadata, downloaded to user's client

### Output 1: Raw Clips (→ Framing Mode)

Each defined clip region is cut from the source video and automatically loaded into Framing mode.

**File Naming Convention** - Uses the clip **name** (sanitized for filesystem):

```
{sanitized_clip_name}.mp4

Examples:
  Name: "00:02:30" (default) → 00-02-30.mp4
  Name: "Great dribble" → Great_dribble.mp4
  Name: "Goal #1" → Goal_1.mp4
```

**Clip Metadata** - Embedded in each clip file using FFmpeg:

```bash
ffmpeg -i input.mp4 \
  -ss 00:02:30 -to 00:02:38 \
  -metadata title="Great dribble" \
  -metadata description="Amazing dribble past 3 defenders" \
  -metadata original_video="soccer_game_2024.mp4" \
  -metadata clip_start="00:02:30" \
  -metadata clip_end="00:02:38" \
  -c copy \
  Great_dribble.mp4
```

### Output 2: Annotated Source Video (→ Download)

The **original full video** is downloaded to the user's client with all clip notes embedded in metadata. This preserves the user's annotations for reference.

**Metadata structure** (embedded as JSON in description field):

```json
{
  "clipify_version": "1.0",
  "clips": [
    {
      "name": "Great dribble",
      "start": "00:02:30",
      "end": "00:02:38",
      "notes": "Amazing dribble past 3 defenders"
    },
    {
      "name": "Through ball",
      "start": "00:15:42",
      "end": "00:15:50",
      "notes": "Assist to goal"
    }
  ]
}
```

**FFmpeg command** for annotated source:

```bash
ffmpeg -i input.mp4 \
  -metadata description='{"clipify_version":"1.0","clips":[...]}' \
  -c copy \
  annotated_source.mp4
```

### Post-Export Flow

After export completes:
1. **Raw clips** are automatically forwarded to Framing mode (no prompt needed)
2. **Annotated source video** is downloaded to user's client
3. User continues workflow in Framing mode with all clips ready for processing
4. Clip metadata (name, notes) is visible in Framing mode clip list

---

## Implementation Tasks

### Task 1: Add "Add Game" Button
**Estimated Effort**: Small
**Files to Modify**:
- `src/frontend/src/components/FileUpload.jsx`
- `src/frontend/src/App.jsx`

**QA Verification**:
- [ ] Open the app with no videos loaded
- [ ] Verify three buttons visible: "Add Raw Clips", "Add Overlay To Framed Video", "Add Game"
- [ ] Click "Add Game" - verify file picker opens
- [ ] Select a video file - verify app enters Clipify mode
- [ ] Verify "Add Raw Clips" still works (goes to Framing mode)
- [ ] Verify "Add Overlay To Framed Video" still works (goes to Overlay mode)

---

### Task 2: Create Clipify Mode State Hook
**Estimated Effort**: Medium
**Files to Create**:
- `src/frontend/src/modes/clipify/hooks/useClipify.js`

**QA Verification**:
- [ ] Import a game video via "Add Game"
- [ ] Verify `editorMode` is set to `'clipify'` (check React DevTools or console)
- [ ] Verify source video metadata is stored (duration, dimensions, framerate)
- [ ] Verify `clipRegions` array is initialized as empty
- [ ] Verify `selectedRegionId` is initialized as null

---

### Task 3: Create Clipify Mode Container with Side Panel Layout
**Estimated Effort**: Medium
**Files to Create**:
- `src/frontend/src/modes/clipify/ClipifyMode.jsx`
- `src/frontend/src/modes/clipify/index.js`

**QA Verification**:
- [ ] Import a game video - verify Clipify mode renders
- [ ] Verify layout has video preview on left (larger area)
- [ ] Verify layout has side panel on right (similar width to Framing clips panel)
- [ ] Verify "Exit Mode" button is visible in header
- [ ] Verify video plays correctly in preview
- [ ] Resize browser window - verify layout remains responsive

---

### Task 4: Create Clips Side Panel Component
**Estimated Effort**: Medium
**Files to Create**:
- `src/frontend/src/modes/clipify/components/ClipsSidePanel.jsx`
- `src/frontend/src/modes/clipify/components/ClipListItem.jsx`

**QA Verification**:
- [ ] Verify side panel header shows "Clips" title
- [ ] Verify "+ Add Clip" button is visible at top of panel
- [ ] With no clips: Verify panel shows empty state message
- [ ] Add a clip: Verify clip appears in side panel list
- [ ] Verify each clip item shows: bullet indicator, name, notes preview (truncated)
- [ ] Click on clip item - verify it becomes selected (highlighted)
- [ ] Verify selected clip shows different visual state (filled bullet vs outline)

---

### Task 5: Implement Default Clip Naming
**Estimated Effort**: Small
**Files to Modify**:
- `src/frontend/src/modes/clipify/hooks/useClipify.js`

**QA Verification**:
- [ ] Seek video to 00:02:30 and add a clip
- [ ] Verify clip name defaults to "00:02:30" in side panel
- [ ] Seek video to 01:15:42 and add a clip
- [ ] Verify clip name defaults to "01:15:42" in side panel
- [ ] Verify notes field defaults to empty

---

### Task 6: Create Clipify Timeline with Region Layer
**Estimated Effort**: Medium
**Files to Create**:
- `src/frontend/src/modes/clipify/ClipifyTimeline.jsx`
- `src/frontend/src/modes/clipify/layers/ClipRegionLayer.jsx`

**QA Verification**:
- [ ] Verify timeline shows below video preview
- [ ] Verify timeline shows full video duration (start to end times)
- [ ] Verify playhead is visible and moves with video playback
- [ ] Click on timeline - verify video seeks to clicked position
- [ ] Add a clip - verify colored region bar appears on timeline
- [ ] Verify clip regions are visually distinct from video track

---

### Task 7: Implement Clip Region Levers (Like Highlight Regions)
**Estimated Effort**: Medium
**Files to Modify**:
- `src/frontend/src/modes/clipify/layers/ClipRegionLayer.jsx`

**QA Verification**:
- [ ] Add a clip - verify start lever (left) is visible on region
- [ ] Add a clip - verify end lever (right) is visible on region
- [ ] Drag start lever left - verify region start time decreases
- [ ] Drag start lever right - verify region start time increases
- [ ] Drag end lever left - verify region end time decreases
- [ ] Drag end lever right - verify region end time increases
- [ ] Verify duration updates in real-time while dragging
- [ ] Verify video preview updates to show current lever position
- [ ] Verify minimum region duration is enforced (e.g., 1 second)

---

### Task 8: Implement Clip Selection on Timeline
**Estimated Effort**: Small
**Files to Modify**:
- `src/frontend/src/modes/clipify/layers/ClipRegionLayer.jsx`
- `src/frontend/src/modes/clipify/components/ClipsSidePanel.jsx`

**QA Verification**:
- [ ] Add multiple clips (at least 3)
- [ ] Click on a clip region in timeline - verify it becomes selected
- [ ] Verify selected clip is highlighted in timeline (brighter/border)
- [ ] Verify corresponding item in side panel is also selected
- [ ] Click on a different clip in side panel - verify it becomes selected
- [ ] Verify corresponding region in timeline is also selected
- [ ] Click empty area of timeline - verify no clip is selected

---

### Task 9: Create Clip Details Editor in Side Panel
**Estimated Effort**: Medium
**Files to Create**:
- `src/frontend/src/modes/clipify/components/ClipDetailsEditor.jsx`

**QA Verification**:
- [ ] Select a clip - verify details editor appears in side panel
- [ ] Verify "Name" text input shows current clip name
- [ ] Verify "Notes" textarea shows current clip notes
- [ ] Verify start time, end time, and duration are displayed (read-only)
- [ ] Edit name field - verify changes are saved
- [ ] Edit notes field - verify changes are saved
- [ ] Verify "Delete Clip" button is visible
- [ ] With no clip selected - verify editor is hidden or shows placeholder

---

### Task 10: Implement Notes Overlay During Playback
**Estimated Effort**: Medium
**Files to Create**:
- `src/frontend/src/modes/clipify/components/NotesOverlay.jsx`

**QA Verification**:
- [ ] Add a clip with notes text
- [ ] Play video from before the clip region
- [ ] Verify notes overlay does NOT appear before entering clip region
- [ ] Verify notes overlay APPEARS when playhead enters clip region
- [ ] Verify overlay shows at TOP of video preview
- [ ] Verify overlay has WHITE background and BLACK text
- [ ] Verify overlay is horizontally centered, ~80% width
- [ ] Verify overlay has rounded corners
- [ ] Verify notes overlay DISAPPEARS when playhead exits clip region
- [ ] Add a clip with EMPTY notes - verify NO overlay appears for that clip
- [ ] Pause video while in clip region - verify overlay remains visible
- [ ] Seek to different clip region - verify correct notes are shown

---

### Task 11: Add Clip Region via Button
**Estimated Effort**: Small
**Files to Modify**:
- `src/frontend/src/modes/clipify/ClipifyMode.jsx`
- `src/frontend/src/modes/clipify/hooks/useClipify.js`

**QA Verification**:
- [ ] Seek video to a specific position
- [ ] Click "+ Add Clip" button in side panel
- [ ] Verify new clip is created at current playhead position
- [ ] Verify default duration is 10 seconds
- [ ] Verify clip name defaults to current timestamp
- [ ] Verify new clip appears in side panel list
- [ ] Verify new clip region appears on timeline
- [ ] Verify new clip is automatically selected

---

### Task 12: Add Clip Region via Keyboard Shortcut
**Estimated Effort**: Small
**Files to Modify**:
- `src/frontend/src/modes/clipify/ClipifyMode.jsx`

**QA Verification**:
- [ ] Seek video to a specific position
- [ ] Press `N` key
- [ ] Verify new clip is created (same behavior as clicking "+ Add Clip")
- [ ] Verify shortcut only works when video preview is focused
- [ ] Verify shortcut does NOT work when editing text fields

---

### Task 13: Delete Clip Region
**Estimated Effort**: Small
**Files to Modify**:
- `src/frontend/src/modes/clipify/components/ClipDetailsEditor.jsx`
- `src/frontend/src/modes/clipify/hooks/useClipify.js`

**QA Verification**:
- [ ] Select a clip
- [ ] Click "Delete Clip" button
- [ ] Verify confirmation dialog appears ("Delete this clip?")
- [ ] Click "Cancel" - verify clip is NOT deleted
- [ ] Click "Delete Clip" again, then click "Confirm"
- [ ] Verify clip is removed from side panel list
- [ ] Verify clip region is removed from timeline
- [ ] Verify another clip becomes selected (if any remain)
- [ ] Press `Delete` key with clip selected - verify same delete flow

---

### Task 14: Exit Clipify Mode
**Estimated Effort**: Small
**Files to Modify**:
- `src/frontend/src/modes/clipify/ClipifyMode.jsx`
- `src/frontend/src/App.jsx`

**QA Verification**:
- [ ] With no clips defined: Click "Exit Mode" - verify returns to no-videos state immediately
- [ ] With clips defined: Click "Exit Mode" - verify warning dialog appears
- [ ] Warning dialog shows: "You have X unsaved clips. Exit anyway?"
- [ ] Click "Cancel" - verify stays in Clipify mode
- [ ] Click "Exit" - verify returns to no-videos state
- [ ] Verify clip data is cleared after exit

---

### Task 15: Create Clips Export Backend Endpoint
**Estimated Effort**: Medium
**Files to Create**:
- `src/backend/app/routers/clipify.py`
**Files to Modify**:
- `src/backend/app/main.py`

**API Contract**:
```
POST /api/clipify/export
Request: {
  video_path: string,
  clips: [{
    start_time: float,
    end_time: float,
    name: string,
    notes: string
  }]
}
Response: {
  exported_clips: [{
    filename: string,
    duration: float,
    blob: binary           // Raw clip data (forwarded to Framing)
  }],
  annotated_source: {
    filename: string,      // Original filename with "_annotated" suffix
    blob: binary           // Source video with clip metadata embedded
  }
}
```

**QA Verification**:
- [ ] Call endpoint via curl/Postman with valid clip definitions
- [ ] Verify `exported_clips` array contains all requested clips
- [ ] Verify each clip filename uses sanitized clip name
- [ ] Verify clip duration matches expected end_time - start_time
- [ ] Open exported clip in video player - verify correct portion was extracted
- [ ] Check clip metadata (ffprobe) - verify title and description are embedded
- [ ] Verify `annotated_source` is returned with embedded clip metadata
- [ ] Check annotated source metadata (ffprobe) - verify JSON with all clips is in description field
- [ ] Verify annotated source video is playable and identical to original
- [ ] Test with clip name containing special characters - verify filename is sanitized
- [ ] Test with duplicate clip names - verify files are not overwritten (add suffix)

---

### Task 16: Implement Frontend Export Flow
**Estimated Effort**: Medium
**Files to Create**:
- `src/frontend/src/modes/clipify/components/ExportClipsButton.jsx`
**Files to Modify**:
- `src/frontend/src/modes/clipify/ClipifyMode.jsx`

**Description**:
Export performs two actions:
1. Cuts raw clips and forwards them to Framing mode automatically
2. Downloads the annotated source video (with clip notes in metadata) to user's client

**QA Verification**:
- [ ] With no clips: Verify "Export Clips" button is disabled
- [ ] With clips: Verify "Export Clips" button is enabled
- [ ] Click "Export Clips" - verify progress modal appears
- [ ] Verify progress shows "Exporting clip X of Y" for each clip
- [ ] Verify progress shows "Creating annotated source..." after clips complete
- [ ] Verify progress bar updates during export
- [ ] Wait for export to complete - verify annotated source download starts automatically
- [ ] Verify annotated source file downloads to user's browser (check Downloads folder)
- [ ] Verify downloaded file has "_annotated" suffix in filename
- [ ] Verify app automatically transitions to Framing mode after export
- [ ] Cancel during export - verify export stops gracefully, no transition occurs

---

### Task 17: Auto-Load Clips to Framing Mode
**Estimated Effort**: Medium
**Files to Modify**:
- `src/frontend/src/modes/clipify/components/ExportClipsButton.jsx`
- `src/frontend/src/App.jsx`
- `src/frontend/src/hooks/useClipManager.js`

**Description**:
After export completes, clips are automatically loaded into Framing mode (no prompt needed).
The annotated source video downloads happen in parallel with the mode transition.

**QA Verification**:
- [ ] Export clips successfully
- [ ] Verify app automatically transitions to Framing mode (no prompt)
- [ ] Verify all exported clips appear in Framing mode clip list
- [ ] Verify clips are playable in Framing mode
- [ ] Verify clip name is visible in Framing mode clip list
- [ ] Verify clip notes metadata is preserved (visible on hover/in details)
- [ ] Verify annotated source video download completes during/after transition
- [ ] Verify user can immediately start working in Framing mode

---

### Task 18: Display Clip Metadata in Framing Mode
**Estimated Effort**: Small
**Files to Modify**:
- `src/frontend/src/components/ClipList.jsx` (or equivalent)
- `src/frontend/src/hooks/useClipManager.js`

**QA Verification**:
- [ ] Load clips from Clipify export into Framing mode
- [ ] Verify clip name is visible in clip list (not just filename)
- [ ] Verify clip notes are visible (tooltip or expandable section)
- [ ] Verify original video source is shown
- [ ] Verify original start/end timestamps are shown
- [ ] Hover over clip - verify tooltip shows full notes text

---

## Files Summary

### Files to Create

| File | Purpose |
|------|---------|
| `src/frontend/src/modes/clipify/ClipifyMode.jsx` | Main clipify mode container |
| `src/frontend/src/modes/clipify/index.js` | Mode exports |
| `src/frontend/src/modes/clipify/hooks/useClipify.js` | Clipify state management |
| `src/frontend/src/modes/clipify/ClipifyTimeline.jsx` | Timeline component |
| `src/frontend/src/modes/clipify/layers/ClipRegionLayer.jsx` | Clip regions on timeline |
| `src/frontend/src/modes/clipify/components/ClipsSidePanel.jsx` | Side panel container |
| `src/frontend/src/modes/clipify/components/ClipListItem.jsx` | Individual clip in list |
| `src/frontend/src/modes/clipify/components/ClipDetailsEditor.jsx` | Edit clip name/notes |
| `src/frontend/src/modes/clipify/components/NotesOverlay.jsx` | Notes text overlay on video |
| `src/frontend/src/modes/clipify/components/ExportClipsButton.jsx` | Export action button |
| `src/backend/app/routers/clipify.py` | Clipify export endpoint |

### Files to Modify

| File | Changes |
|------|---------|
| `src/frontend/src/components/FileUpload.jsx` | Add "Add Game" button |
| `src/frontend/src/App.jsx` | Add clipify mode state, handle game import callback |
| `src/frontend/src/hooks/useClipManager.js` | Support clip metadata, auto-load from clipify |
| `src/frontend/src/components/ClipList.jsx` | Display clip metadata from Clipify |
| `src/backend/app/main.py` | Register clipify router |

---

## UI/UX Considerations

### Color Coding

| Element | Color |
|---------|-------|
| Clip region (timeline) | Blue (#3B82F6) |
| Selected clip region | Brighter blue with border (#60A5FA, 2px border) |
| Start lever | Green (#22C55E) |
| End lever | Red (#EF4444) |
| Notes overlay background | White (#FFFFFF, 90% opacity) |
| Notes overlay text | Black (#000000) |

### Notes Overlay Styling

```css
.notes-overlay {
  position: absolute;
  top: 8px;
  left: 10%;
  width: 80%;
  background: rgba(255, 255, 255, 0.95);
  color: #000;
  padding: 8px 16px;
  border-radius: 8px;
  font-size: 14px;
  line-height: 1.4;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  z-index: 100;
}
```

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `N` | Add new clip region at playhead |
| `Delete` | Delete selected clip region |
| `[` | Move playhead to selected region start |
| `]` | Move playhead to selected region end |
| `Space` | Play/pause video |
| `Left/Right` | Step frame backward/forward |

---

## Acceptance Criteria

### Entry Point
- [ ] "Add Game" button visible alongside "Add Raw Clips" and "Add Overlay To Framed Video"
- [ ] Clicking "Add Game" opens file picker
- [ ] Single video file imports into Clipify mode

### Layout
- [ ] Video preview on left, side panel on right
- [ ] Side panel similar to Framing mode clips panel
- [ ] Timeline below video preview

### Clip Definition
- [ ] Can add clip regions via button or keyboard
- [ ] Regions have draggable start/end levers (like highlight regions)
- [ ] Default clip name is timestamp (e.g., "00:02:30")
- [ ] User can edit clip name in side panel
- [ ] User can add notes in side panel
- [ ] Clip list shows all defined clips with name and notes preview

### Notes Overlay
- [ ] During playback, notes appear at top of video
- [ ] White background, black text
- [ ] Only appears when playhead is in a clip region
- [ ] Only shows if clip has notes (not empty)
- [ ] Disappears when playhead exits clip region

### Export
- [ ] Export produces two outputs: raw clips + annotated source video
- [ ] Raw clips are cut from source and forwarded to Framing mode
- [ ] Annotated source video (with clip notes in metadata) downloads to user's client
- [ ] Filenames use clip names (sanitized)
- [ ] Metadata (name, notes) embedded in clip files
- [ ] Progress shown during export
- [ ] Annotated source download starts automatically on completion

### Transition to Framing
- [ ] Clips automatically load into Framing mode after export (no prompt)
- [ ] Clip metadata visible in Framing mode clip list
- [ ] User can immediately start Framing workflow

### Edge Cases
- [ ] Overlapping clips: Show warning, allow anyway
- [ ] Very short clips (<1s): Show warning, allow anyway
- [ ] Very long clips (>60s): Show warning, allow anyway
- [ ] No clips defined: Export button disabled
- [ ] Duplicate clip names: Auto-suffix with number

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
| User loses work on exit | Warn on exit if clips defined |
| Clip boundaries off by frames | Use frame-accurate seeking, show frame numbers |
| Notes overlay obscures video | Keep overlay compact, position at very top |
