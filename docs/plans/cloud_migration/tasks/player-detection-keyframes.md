# Player Detection Keyframes

## Problem Statement

Current player detection runs once and requires manual crop adjustment. Users need an easier way to select which player to track.

## Proposed Solution

1. **Run detection on 4 frames** - Evenly spaced in the first 2 seconds of the clip
2. **Create keyframes from detections** - Each detected frame becomes a keyframe with bounding boxes
3. **Click-to-select UI** - User clicks a keyframe, then clicks on a player rectangle to set tracking target

## User Flow

```
1. User loads clip in Framing mode
2. System auto-runs detection on frames at 0s, 0.66s, 1.33s, 2s
3. Keyframes appear in timeline with detection rectangles
4. User clicks keyframe → frame shows with player bounding boxes overlaid
5. User clicks on a player rectangle → that player becomes the tracking target
6. Crop box centers on selected player
7. User can click different keyframes to verify tracking across time
```

## Technical Implementation

### Backend Changes

#### 1. New Detection Endpoint

```python
# In detect.py or framing.py
@router.post("/detect-players-multi")
async def detect_players_multi_frame(
    clip_id: int,
    num_frames: int = 4,
    time_window: float = 2.0,  # First 2 seconds
):
    """
    Run player detection on multiple frames.
    Returns list of frames with bounding boxes.
    """
    # Calculate frame timestamps
    timestamps = [i * time_window / (num_frames - 1) for i in range(num_frames)]

    # Run detection on each frame (can parallelize on Modal)
    detections = []
    for ts in timestamps:
        boxes = detect_players_at_timestamp(clip_id, ts)
        detections.append({
            "timestamp": ts,
            "boxes": boxes  # List of {x, y, width, height, confidence}
        })

    return {"detections": detections}
```

#### 2. Modal Function Update

```python
# In video_processing.py
@app.function(gpu="T4", timeout=120)
def detect_players_multi(
    input_url: str,
    timestamps: list[float],
) -> list[dict]:
    """Detect players at multiple timestamps."""
    results = []
    for ts in timestamps:
        frame = extract_frame_at_timestamp(input_url, ts)
        boxes = run_yolo_detection(frame)
        results.append({"timestamp": ts, "boxes": boxes})
    return results
```

### Frontend Changes

#### 1. Detection Keyframes in Timeline

```javascript
// FramingTimeline.jsx or similar
function DetectionKeyframes({ detections, onKeyframeClick }) {
    return detections.map(det => (
        <KeyframeMarker
            key={det.timestamp}
            position={det.timestamp}
            onClick={() => onKeyframeClick(det)}
            hasDetections={det.boxes.length > 0}
        />
    ));
}
```

#### 2. Player Selection Overlay

```javascript
// PlayerSelectionOverlay.jsx
function PlayerSelectionOverlay({ frame, boxes, onPlayerSelect }) {
    return (
        <div className="player-overlay">
            {boxes.map((box, i) => (
                <div
                    key={i}
                    className="player-box"
                    style={{
                        left: `${box.x}%`,
                        top: `${box.y}%`,
                        width: `${box.width}%`,
                        height: `${box.height}%`,
                    }}
                    onClick={() => onPlayerSelect(box)}
                >
                    <span className="confidence">{box.confidence}%</span>
                </div>
            ))}
        </div>
    );
}
```

#### 3. State Management

```javascript
// In framing store or component
const [detections, setDetections] = useState([]);
const [selectedKeyframe, setSelectedKeyframe] = useState(null);
const [selectedPlayer, setSelectedPlayer] = useState(null);

const handlePlayerSelect = (box) => {
    setSelectedPlayer(box);
    // Center crop on this player
    setCropPosition({
        x: box.x + box.width / 2,
        y: box.y + box.height / 2,
    });
};
```

## Database Changes

Optional - could store detections for reuse:

```sql
CREATE TABLE clip_detections (
    id INTEGER PRIMARY KEY,
    clip_id INTEGER REFERENCES working_clips(id),
    timestamp REAL,
    boxes TEXT,  -- JSON array of bounding boxes
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

## Files to Modify

| File | Changes |
|------|---------|
| `src/backend/app/routers/detect.py` | New multi-frame detection endpoint |
| `src/backend/app/modal_functions/video_processing.py` | Multi-frame detection function |
| `src/frontend/src/modes/FramingModeView.jsx` | Add detection keyframes and overlay |
| `src/frontend/src/components/PlayerSelectionOverlay.jsx` | New component for click-to-select |

## Edge Cases

1. **No players detected** - Show message, allow manual crop
2. **Player leaves frame** - Some keyframes may not have the target player
3. **Multiple similar players** - User picks one, system tracks based on position continuity
4. **Clip shorter than 2s** - Adjust timestamps to fit clip duration

## Success Criteria

- [ ] Detection runs automatically when clip loads in Framing mode
- [ ] 4 keyframes appear in timeline (or fewer if clip < 2s)
- [ ] Clicking keyframe shows frame with bounding boxes
- [ ] Clicking bounding box sets that player as target
- [ ] Crop box centers on selected player
- [ ] Works with Modal GPU processing
