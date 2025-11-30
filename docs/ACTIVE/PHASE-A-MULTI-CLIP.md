# Phase A: Multi-Clip + Transitions

**Status**: NEXT
**Priority**: HIGH
**Scope**: Framing Mode enhancement

---

## Overview

Add support for multiple video clips in Framing mode. Users can import several video files, each becomes a clip on a dedicated clip layer. Users can drag to reorder clips and set transitions between them. All existing features (crop keyframes, speed regions, trim) work per-clip.

---

## User Stories

1. As a user, I want to import multiple video files so I can combine different angles or segments
2. As a user, I want to see each clip as a region on a clip layer
3. As a user, I want to drag clips to reorder them on the timeline
4. As a user, I want to set transitions (cut, fade, dissolve) between clips
5. As a user, I want each clip to have its own crop keyframes and speed settings
6. As a user, I want to delete clips I don't need

---

## Data Models

### Clip

```typescript
interface Clip {
  id: string;                    // Unique identifier (UUID)
  file: File;                    // Original video file
  fileName: string;              // Display name

  // Source video properties
  sourceDuration: number;        // Original duration in seconds
  sourceWidth: number;           // Original width
  sourceHeight: number;          // Original height
  sourceFramerate: number;       // Original framerate

  // Trim range (within source video)
  trimStart: number;             // Start time in source (seconds)
  trimEnd: number;               // End time in source (seconds)

  // Per-clip effects
  cropKeyframes: CropKeyframe[]; // Keyframe times are relative to source
  speedRegions: SpeedRegion[];   // Speed regions for this clip

  // Position in timeline
  timelineStart: number;         // Where this clip starts in output timeline

  // Calculated
  outputDuration: number;        // Duration in output (after trim/speed)
}
```

### Transition

```typescript
interface Transition {
  id: string;
  type: 'cut' | 'fade' | 'dissolve';
  duration: number;              // Duration in seconds (0 for cut)
  clipBeforeId: string;          // Clip before transition
  clipAfterId: string;           // Clip after transition
}
```

### Project (extends existing state)

```typescript
interface Project {
  clips: Clip[];                 // Ordered list of clips
  transitions: Transition[];     // Transitions between clips

  // Global settings
  outputAspectRatio: AspectRatio;
  outputResolution: Resolution;
}
```

---

## UI Changes

### Timeline

```
┌─────────────────────────────────────────────────────────────────┐
│ Clip Layer                                                       │
│ ┌──────────┐   ┌──────────────┐   ┌────────┐                   │
│ │  Clip 1  │─◇─│   Clip 2     │─◇─│ Clip 3 │                   │
│ └──────────┘ ↑ └──────────────┘ ↑ └────────┘                   │
│   (drag to   │    (drag to      │                               │
│    reorder)  │     reorder)     │                               │
│          transition         transition                           │
│          (click to          (click to                           │
│           change)            change)                             │
├─────────────────────────────────────────────────────────────────┤
│ Crop Track (shows keyframes for selected clip)                  │
│ ◆──────────────────◆─────────────────◆                         │
├─────────────────────────────────────────────────────────────────┤
│ Playhead                                                         │
│ ▼                                                               │
└─────────────────────────────────────────────────────────────────┘
```

### New Controls

1. **Add Clip Button**: Opens file picker for additional videos (or drag & drop)
2. **Clip Regions**: Drag to reorder, click to select for editing
3. **Transition Markers** (◇): Click between clips to change transition type
4. **Delete Clip**: Remove clip from timeline

---

## Implementation Steps

### Step 1: Multi-Clip State Management

Create a new hook `useClips` that manages the clip collection:

```javascript
// src/frontend/src/hooks/useClips.js

function useClips() {
  const [clips, setClips] = useState([]);
  const [selectedClipId, setSelectedClipId] = useState(null);
  const [transitions, setTransitions] = useState([]);

  // Add a new clip
  const addClip = async (file) => {
    const metadata = await extractVideoMetadata(file);
    const newClip = {
      id: uuid(),
      file,
      fileName: file.name,
      sourceDuration: metadata.duration,
      sourceWidth: metadata.width,
      sourceHeight: metadata.height,
      sourceFramerate: metadata.framerate,
      trimStart: 0,
      trimEnd: metadata.duration,
      cropKeyframes: [],
      speedRegions: [{ start: 0, end: metadata.duration, speed: 1.0 }],
      timelineStart: calculateNextTimelineStart(clips),
      outputDuration: metadata.duration,
    };

    setClips(prev => [...prev, newClip]);
    setSelectedClipId(newClip.id);

    // Add default cut transition if not first clip
    if (clips.length > 0) {
      addTransition(clips[clips.length - 1].id, newClip.id, 'cut');
    }

    return newClip;
  };

  // Reorder clips (drag and drop)
  const moveClip = (clipId, newIndex) => {
    // Reorder and recalculate timeline positions
  };

  // Delete clip
  const deleteClip = (clipId) => {
    // ... removes clip and associated transitions
  };

  // Update transition type
  const setTransitionType = (transitionId, type, duration) => {
    // ...
  };

  return {
    clips,
    selectedClipId,
    transitions,
    addClip,
    splitClip,
    moveClip,
    deleteClip,
    selectClip: setSelectedClipId,
    setTransitionType,
    // ... other methods
  };
}
```

### Step 2: Timeline Updates

Modify `FramingTimeline.jsx` to render multiple clips:

```javascript
// Render clip track
{clips.map((clip, index) => (
  <ClipBlock
    key={clip.id}
    clip={clip}
    isSelected={clip.id === selectedClipId}
    onClick={() => selectClip(clip.id)}
    onDragEnd={(newIndex) => moveClip(clip.id, newIndex)}
  />
))}

// Render transitions between clips
{transitions.map(transition => (
  <TransitionMarker
    key={transition.id}
    transition={transition}
    onClick={() => openTransitionPicker(transition.id)}
  />
))}
```

### Step 3: Drag-to-Reorder

Implement drag and drop for clip reordering:

```javascript
const handleClipDragEnd = (clipId, newIndex) => {
  // Reorder clips array
  const currentIndex = clips.findIndex(c => c.id === clipId);
  if (currentIndex === newIndex) return;

  const reordered = [...clips];
  const [removed] = reordered.splice(currentIndex, 1);
  reordered.splice(newIndex, 0, removed);

  // Recalculate timeline positions
  let timelineStart = 0;
  const updated = reordered.map(clip => {
    const newClip = { ...clip, timelineStart };
    timelineStart += clip.outputDuration;
    return newClip;
  });

  setClips(updated);
};
```

### Step 4: Transition Rendering (Export)

Update the export pipeline to handle transitions:

```python
# Backend: routers/export.py

def render_with_transitions(clips, transitions, output_path):
    """Render clips with transitions using FFmpeg"""

    # Render each clip individually
    rendered_clips = []
    for clip in clips:
        clip_path = render_single_clip(clip)
        rendered_clips.append(clip_path)

    # Build FFmpeg filter for transitions
    filter_complex = build_transition_filter(rendered_clips, transitions)

    # Run FFmpeg with filter
    ffmpeg.input(...).filter_complex(filter_complex).output(output_path).run()
```

### Step 5: Per-Clip Effects

Ensure existing hooks work with selected clip:

```javascript
// In useCrop, useSegments, etc.
// Effects should be scoped to the currently selected clip

const {
  keyframes,
  addOrUpdateKeyframe,
  // ...
} = useCrop(
  selectedClip?.metadata,
  selectedClip?.trimRange,
  selectedClip?.id  // NEW: Scope keyframes to this clip
);
```

---

## Export Data Structure

```json
{
  "clips": [
    {
      "id": "clip-1",
      "source_path": "/uploads/video1.mp4",
      "trim_start": 0.0,
      "trim_end": 10.5,
      "crop_keyframes": [...],
      "speed_regions": [...]
    },
    {
      "id": "clip-2",
      "source_path": "/uploads/video2.mp4",
      "trim_start": 5.0,
      "trim_end": 15.0,
      "crop_keyframes": [...],
      "speed_regions": [...]
    }
  ],
  "transitions": [
    {
      "type": "fade",
      "duration": 0.5,
      "between": ["clip-1", "clip-2"]
    }
  ],
  "output": {
    "format": "mp4",
    "codec": "h264",
    "aspect_ratio": "9:16"
  }
}
```

---

## Testing Requirements

### Unit Tests

- [ ] `useClips` hook: add, remove, reorder clips
- [ ] Timeline position calculations: clips don't overlap
- [ ] Transition validation: only between adjacent clips
- [ ] Reorder recalculates all timeline positions correctly

### Integration Tests

- [ ] Import multiple videos, arrange, export
- [ ] Transitions render correctly in exported video
- [ ] Per-clip speed regions work independently
- [ ] Per-clip crop keyframes work independently

### Manual Tests

- [ ] Drag and drop reordering feels responsive
- [ ] Transition picker UI is intuitive
- [ ] Timeline zooms correctly with multiple clips
- [ ] Playback crosses clip boundaries smoothly

---

## Acceptance Criteria

1. **Multi-Import**: Can import 2+ video files into a single project
2. **Clip Layer**: Each clip shown as a region on the clip layer
3. **Drag to Reorder**: Can drag clips to change their order
4. **Transitions**: Fade and dissolve transitions work in export
5. **Per-Clip Effects**: Each clip can have independent crop keyframes and speed
6. **Delete**: Can remove a clip from the timeline
7. **Export**: All clips and transitions render correctly in final video

---

## Technical Notes

### FFmpeg Transition Filters

```bash
# Fade transition between two clips (crossfade)
ffmpeg -i clip1.mp4 -i clip2.mp4 \
  -filter_complex "[0:v][1:v]xfade=transition=fade:duration=0.5:offset=9.5[v]" \
  -map "[v]" output.mp4

# Dissolve is similar but uses 'dissolve' transition type
```

### Keyframe Time Handling

When clips are reordered, keyframe times remain relative to the clip's source video. Only `timelineStart` changes.

### Memory Considerations

With multiple video files loaded, consider:
- Only keeping metadata in memory, not full video data
- Loading video frames on-demand for preview
- Streaming approach for export

---

## Dependencies

- Existing: `useCrop`, `useSegments`, `useVideo`
- New: `useClips` hook, `ClipBlock` component, `TransitionMarker` component
- Backend: Updated export endpoint to handle multi-clip + transitions

---

## File Changes Expected

```
src/frontend/src/
├── hooks/
│   └── useClips.js              # NEW
├── modes/framing/
│   ├── FramingTimeline.jsx      # MODIFY: Multi-clip rendering
│   ├── layers/
│   │   └── ClipLayer.jsx        # NEW: Clip regions with drag-to-reorder
│   ├── components/
│   │   ├── ClipBlock.jsx        # NEW: Individual clip region
│   │   └── TransitionMarker.jsx # NEW: Clickable transition between clips
│   └── contexts/
│       └── ClipsContext.jsx     # NEW
└── components/
    └── TransitionPicker.jsx     # NEW: Dialog to select transition type

src/backend/app/
└── routers/
    └── export.py                # MODIFY: Multi-clip rendering
```
