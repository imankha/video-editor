# T710: Play Annotations Mode (Replace "Create Annotated Video")

**Status:** TODO
**Impact:** 9
**Complexity:** 7
**Created:** 2026-03-25
**Updated:** 2026-03-25

## Problem

"Create Annotated Video" burns a new video server-side (FFmpeg on Modal/local), which:
1. **Costs money** — GPU/CPU time per export
2. **Slow feedback loop** — users frequently change annotations while watching, then must re-export
3. **Redundant work** — the original video already contains all the frames; we're just selecting which ones to show

## Solution

Replace "Create Annotated Video" with **"Play Annotations"** — a frontend-only playback mode that plays the annotated clips in sequence directly from the source video, as if a burned video were playing. No backend processing needed.

### Core Concept: Virtual Timeline

The source video is `[0, totalDuration]`. The user's clips define an ordered subset of time ranges. "Play Annotations" builds a **virtual timeline** that maps `[0, virtualDuration]` → the actual source times.

```
Clips (sorted by startTime):
  Clip A: [10s, 25s]  → 15s
  Clip B: [45s, 55s]  → 10s
  Clip C: [120s, 140s] → 20s

Virtual timeline: [0s, 45s] total
  Virtual [0, 15)   → Actual [10, 25)    (Clip A)
  Virtual [15, 25)  → Actual [45, 55)    (Clip B)
  Virtual [25, 45)  → Actual [120, 140)  (Clip C)
```

### Two Phases

**Phase 1: Core Playback**
- Toggle button: "Play Annotations" ↔ "Back to Annotating"
- Completely replaces "Create Annotated Video" (delete all burn/export code)
- Dual-video ping-pong for seamless transitions between clips
- Annotated clips play at 0.5x speed (study/coaching tool)
- Cross-video playback (T82 multi-video games)
- Custom controls: progress bar shows virtual duration, time display shows virtual time
- NotesOverlay displays each clip's name/rating/notes during its segment
- Sidebar clip list stays visible, highlights currently-playing clip
- No clips layer on timeline (markers hidden during playback)
- Pause/play, seek within virtual timeline

**Phase 2: Smart Bridging Playback**
- Gaps ≤ `BRIDGE_GAP_THRESHOLD_SECONDS` (30s) between consecutive clips become "bridge" segments
- Bridge segments play at 1.5x speed (fast-forward through non-annotated content)
- Speed transitions are smooth (no jarring jumps)
- Virtual timeline accounts for bridge durations at their playback speed
- Progress bar visually distinguishes annotated vs bridge segments (color-coded)

## Technical Approach

### Recommended: Seek-and-Play with Dual Video Elements

Based on research, the **dual-video-element ping-pong** pattern provides the best balance of smooth transitions and implementation simplicity:

1. Two `<video>` elements pointing to the same source URL
2. Video A plays the current segment; Video B pre-seeks to the next segment's start
3. At segment boundary: swap visibility (A hidden, B shown), start B, then A pre-loads next
4. CSS opacity transition (50-100ms) hides the swap
5. Single `<canvas>` fallback: if dual-element is too complex for Phase 1, use a single video with a canvas snapshot of the last frame shown during seek gaps

### Virtual Timeline Engine (Core Abstraction)

```
Input:  clips[] sorted by startTime, each with {startTime, endTime}
Output: VirtualTimeline object

VirtualTimeline:
  .totalDuration        → sum of clip durations
  .virtualToActual(vt)  → {clipIndex, actualTime}
  .actualToVirtual(at, clipIndex) → virtualTime
  .getSegmentAt(vt)     → {clip, isAnnotated, playbackRate}  (Phase 2: includes bridges)
```

This is pure math — no DOM, no React. Can be unit tested independently.

### Phase 2: Bridge Segments

```
Clips: A=[10,25], B=[45,55], C=[50,70]

Gap A→B = 20s (≤ 30s threshold) → bridge at 1.5x → effective duration = 20/1.5 = 13.3s
Gap B→C = 0s (overlapping/adjacent) → no bridge

Timeline segments:
  [Clip A @ 0.5x] [Bridge @ 1.5x] [Clip B @ 0.5x] [Clip C @ 0.5x]

Virtual durations:
  Clip A: 15s / 0.5 = 30s effective
  Bridge: 20s / 1.5 = 13.3s effective
  Clip B: 10s / 0.5 = 20s effective
  Clip C: 20s / 0.5 = 40s effective
  Total: 103.3s virtual
```

### Alternatives Considered

| Approach | Pros | Cons |
|----------|------|------|
| **Seek-and-play (single video)** | Simplest code | 50-200ms black flash between clips |
| **Dual video ping-pong** | Smooth transitions, reasonable complexity | Two video elements, swap logic |
| **MSE (Media Source Extensions)** | Truly seamless, frame-perfect | Very complex (MP4 parsing, keyframe alignment, SourceBuffer management) |
| **Canvas-based** | Full control over every frame | CPU-intensive, loses hardware decode |

**Decision:** Use dual-video ping-pong from the start. The user should not feel any difference between this and actual video playback. No compromises on transition quality.

## UI Design

### Layout

```
┌──────────────────────────────────┬──────────────┐
│          Video Player            │  Clip List   │
│       (NotesOverlay active)      │  ► Clip 1    │
│                                  │  ● Clip 2 ◄──│── highlighted (playing)
│                                  │  ► Clip 3    │
│                                  │  ► Clip 4    │
├──────────────────────────────────┤              │
│ ◄◄  ▶  ►►  │  02:15 / 04:30     │              │
├──────────────────────────────────┤              │
│ ████████▓▓▓▓████████░░░░░░░░░░  │              │
│ Clip1 @0.5x  Bridge  Clip2@0.5x │              │
│              @1.5x               │              │
├──────────────────────────────────┤              │
│  [◀ Back to Annotating]         │              │
└──────────────────────────────────┴──────────────┘
```

### Progress Bar

```
████████████▓▓▓▓████████████████████░░░░░░
 Clip A @0.5x  Bridge  Clip B @0.5x
               @1.5x

████ = annotated (green/blue)
▓▓▓▓ = bridge (gray/dim)
░░░░ = remaining
```

## Decisions (Resolved)

1. **"Create Annotated Video" is removed entirely.** Delete all export/burn code paths (backend endpoint, frontend callAnnotateExportApi, Modal integration for annotate export). Play Annotations fully replaces it.

2. **Annotated clips play at 0.5x** — this is a study/coaching tool, slow motion is the point.

3. **Bridge threshold is 30s, defined as a single constant** (e.g., `BRIDGE_GAP_THRESHOLD_SECONDS = 30`). Easy for a developer to change but not user-configurable.

4. **Cross-video playback required from Phase 1.** Multi-video games (T82) mean clips can reference different source videos. The dual-video approach naturally supports this — each element can load a different source URL when the next clip is from a different video.

5. **Sidebar stays visible during playback.** The currently-playing clip is highlighted in the clip list. This provides context and supports fullscreen mode (which needs the clip list accessible).

6. **Dual-video ping-pong from the start.** No single-video fallback. The user should not feel any difference between this and a burned video playback.

## Context

### Relevant Files (REQUIRED)

**Frontend — will change:**
- `src/frontend/src/modes/AnnotateModeView.jsx` — Replace "Create Annotated Video" button with "Play Annotations" toggle
- `src/frontend/src/screens/AnnotateScreen.jsx` — Mode state, pass playback props
- `src/frontend/src/containers/AnnotateContainer.jsx` — Remove export logic, add playback state management
- `src/frontend/src/components/VideoPlayer.jsx` — Dual video element support (ping-pong)
- `src/frontend/src/modes/annotate/AnnotateTimeline.jsx` — Virtual timeline display in playback mode
- `src/frontend/src/modes/annotate/components/ClipsSidePanel.jsx` — Highlight currently-playing clip

**Frontend — new files:**
- `src/frontend/src/modes/annotate/hooks/useVirtualTimeline.js` — Virtual timeline engine (pure math, unit testable)
- `src/frontend/src/modes/annotate/hooks/useAnnotationPlayback.js` — Playback controller (dual-video swap, speed, cross-video loading)
- `src/frontend/src/modes/annotate/components/PlaybackControls.jsx` — Custom controls for playback mode

**Frontend — reference (existing patterns):**
- `src/frontend/src/modes/annotate/hooks/useAnnotate.js` — `getRegionAtTime()`, clip data model
- `src/frontend/src/modes/annotate/hooks/useClipSelection.js` — State machine pattern
- `src/frontend/src/hooks/useVideo.js` — Video playback primitives (seek, play, pause)

**Frontend — delete (export/burn code):**
- `src/frontend/src/containers/AnnotateContainer.jsx` — `callAnnotateExportApi()`, `handleCreateAnnotatedVideo()`, WebSocket export progress tracking
- Related export UI: progress bar, export toast, `isCreatingAnnotatedVideo` state

**Backend — delete:**
- `src/backend/app/routers/annotate.py` — `export_clips` endpoint, `run_annotate_export_processing()`, burned text overlay FFmpeg code, video concatenation code
- Any Modal integration specific to annotate export

### Research: Indexed Video Playback Patterns

**No existing library solves this exactly.** The closest patterns:

1. **Dual video ping-pong (CHOSEN)** — Two `<video>` elements, same source (or different sources for cross-video). One plays, one pre-seeks. Swap visibility at segment boundary with CSS opacity transition. Eliminates visible gaps. Naturally supports cross-video playback since each element can load a different URL.

2. **Seek-and-play (rejected)** — Single video, seek on `timeupdate`. 50-200ms black flash between clips. Not acceptable for a seamless experience.

3. **Media Source Extensions (rejected)** — Truly seamless but requires MP4 parsing, keyframe alignment, SourceBuffer management. Overkill when dual-video achieves the same UX.

4. **Canvas snapshot bridge (rejected)** — Single video + canvas freeze during seek. Simpler than dual-video but still has a visible freeze frame moment.
