# Phase B: Overlay Mode Expansion

**Status**: PLANNED
**Priority**: HIGH
**Scope**: Overlay Mode enhancement with soccer-specific visualizations

---

## Overview

Expand the Overlay Mode with a rich set of visualization tools designed specifically for soccer content. The goal is to help viewers appreciate the skill being demonstrated through visual effects like highlights, text annotations, ball tracking effects, and tactical visualizations.

All overlay types share a common interface for consistency and extensibility.

---

## User Stories

1. As a user, I want to add text labels to identify players or add commentary
2. As a user, I want to highlight the ball with brightness/motion effects
3. As a user, I want to show when a dribbler looks up (scan visualization)
4. As a user, I want to visualize the space created by a dribble
5. As a user, I want to mark beaten defenders with X symbols
6. As a user, I want to show passing lanes on through balls
7. As a user, I want to edit any overlay's properties via a click-to-open dialog
8. As a user, I want to toggle visibility of individual layers
9. As a user, I want keyframe animation on any overlay property

---

## Overlay Types

### 1. Highlight (Existing - Enhance)

Elliptical spotlight effect on a player.

**Properties**:
| Property | Type | Default | Description |
|----------|------|---------|-------------|
| x, y | number | center | Position (0-1 normalized) |
| radiusX, radiusY | number | 0.1 | Ellipse radii |
| effectType | enum | 'original' | 'brightness_boost', 'original', 'dark_overlay' |
| opacity | number | 0.7 | Effect intensity |
| color | string | '#FFFF00' | Color tint (for dark_overlay) |

---

### 2. Text Overlay (NEW)

Text labels for player names, stats, or commentary.

**Properties**:
| Property | Type | Default | Description |
|----------|------|---------|-------------|
| x, y | number | 0.5 | Position (0-1 normalized) |
| text | string | '' | The text content |
| fontSize | number | 24 | Font size in pixels |
| fontFamily | string | 'Arial' | Font family |
| fontWeight | string | 'bold' | Font weight |
| color | string | '#FFFFFF' | Text color |
| backgroundColor | string | null | Optional background pill |
| backgroundPadding | number | 8 | Padding around text |
| opacity | number | 1.0 | Overall opacity |
| anchor | enum | 'center' | 'top-left', 'center', 'bottom-right', etc. |

**Use Cases**:
- Player name labels
- "GOAL!" or "ASSIST!" annotations
- Score overlays
- Timestamps

---

### 3. Ball Effect (NEW)

Visual effects on the ball.

**Properties**:
| Property | Type | Default | Description |
|----------|------|---------|-------------|
| x, y | number | - | Ball position (0-1) |
| radius | number | 0.02 | Ball highlight radius |
| effectType | enum | 'glow' | 'glow', 'trail', 'spotlight' |
| glowColor | string | '#FFFFFF' | Glow color |
| glowIntensity | number | 0.8 | Glow brightness |
| trailLength | number | 5 | Frames of motion trail |
| trailOpacity | number | 0.5 | Trail fade |

**Use Cases**:
- Highlight ball during key moments
- Show ball trajectory with motion blur
- Make ball visible in crowded scenes

---

### 4. Scan Indicator (NEW)

Shows when a player looks up to scan the field.

**Properties**:
| Property | Type | Default | Description |
|----------|------|---------|-------------|
| x, y | number | - | Player head position |
| startAngle | number | -60 | Scan start angle (degrees) |
| endAngle | number | 60 | Scan end angle |
| radius | number | 0.15 | Scan arc radius |
| color | string | '#00FF00' | Arc color |
| animated | boolean | true | Animate the scan |
| duration | number | 0.3 | Animation duration (seconds) |

**Visual**:
```
        ╭──────╮
       ╱   👁   ╲    <- scan arc emanating from player
      ╱          ╲
```

---

### 5. Space Visualization (NEW)

Shows space created by dribble or movement.

**Properties**:
| Property | Type | Default | Description |
|----------|------|---------|-------------|
| points | Point[] | [] | Polygon defining space |
| fillColor | string | '#00FF00' | Fill color |
| fillOpacity | number | 0.3 | Fill transparency |
| strokeColor | string | '#00FF00' | Border color |
| strokeWidth | number | 2 | Border width |
| label | string | '' | Optional label ("10m gained") |

**Visual**:
```
     ┌─────────────┐
     │             │
     │   SPACE     │  <- highlighted zone
     │   CREATED   │
     └─────────────┘
```

---

### 6. Defender Marker (NEW)

X mark on beaten defenders.

**Properties**:
| Property | Type | Default | Description |
|----------|------|---------|-------------|
| x, y | number | - | Defender position |
| size | number | 30 | Marker size in pixels |
| color | string | '#FF0000' | X color |
| strokeWidth | number | 4 | Line thickness |
| animated | boolean | true | Pop-in animation |
| label | string | '' | Optional "#1", "#2" for count |

**Visual**:
```
    ╲   ╱
     ╲ ╱   #1
      ╳
     ╱ ╲
    ╱   ╲
```

---

### 7. Through Ball Line (NEW)

Shows passing lane and beaten defenders.

**Properties**:
| Property | Type | Default | Description |
|----------|------|---------|-------------|
| startX, startY | number | - | Passer position |
| endX, endY | number | - | Receiver position |
| lineColor | string | '#FFFF00' | Line color |
| lineStyle | enum | 'solid' | 'solid', 'dashed', 'arrow' |
| lineWidth | number | 3 | Line thickness |
| animated | boolean | true | Animate line drawing |
| defenderMarkers | Point[] | [] | Positions of beaten defenders |

**Visual**:
```
    [Passer] ─────────────────> [Receiver]
                  ╳     ╳
            (beaten defenders)
```

---

## Common Layer Interface

All overlay types implement a common interface for consistency.

### BaseLayer Interface

```typescript
interface BaseLayer {
  id: string;                    // Unique identifier
  type: LayerType;               // 'highlight' | 'text' | 'ball' | etc.
  name: string;                  // User-editable display name
  visible: boolean;              // Toggle visibility
  locked: boolean;               // Prevent editing
  zIndex: number;                // Stacking order
  keyframes: LayerKeyframe[];    // Animation keyframes
  properties: LayerProperties;   // Type-specific properties
}

interface LayerKeyframe {
  frame: number;                 // Frame number
  properties: Partial<LayerProperties>;  // Animated properties
}

type LayerType =
  | 'highlight'
  | 'text'
  | 'ball_effect'
  | 'scan_indicator'
  | 'space_viz'
  | 'defender_marker'
  | 'through_ball';
```

### Layer Registry

```typescript
// Registry for extensibility
const LayerRegistry = {
  highlight: {
    component: HighlightLayer,
    icon: '🔦',
    defaultProperties: { ... },
    propertySchema: { ... },
  },
  text: {
    component: TextLayer,
    icon: '📝',
    defaultProperties: { ... },
    propertySchema: { ... },
  },
  // ... more layer types
};
```

---

## Properties Dialog

When a user clicks on an overlay, a properties dialog opens (not inline editing in main UI).

### Dialog Layout

```
┌─────────────────────────────────────┐
│  Layer: Player Name Label     [X]   │
├─────────────────────────────────────┤
│  Type: Text                         │
│                                     │
│  ┌─ Properties ──────────────────┐  │
│  │ Text:    [Messi           ]   │  │
│  │ Font:    [Arial      ▼]       │  │
│  │ Size:    [24    ] px          │  │
│  │ Color:   [■ #FFFFFF]          │  │
│  │ Position: X [0.5] Y [0.8]     │  │
│  │ Opacity: [======●===] 80%     │  │
│  └───────────────────────────────┘  │
│                                     │
│  ┌─ Keyframe ────────────────────┐  │
│  │ ◆ Add keyframe at current time│  │
│  │ ◆ Copy from previous keyframe │  │
│  └───────────────────────────────┘  │
│                                     │
│  [Delete Layer]        [Done]       │
└─────────────────────────────────────┘
```

### Implementation

```typescript
interface PropertiesDialogProps {
  layer: BaseLayer;
  currentTime: number;
  onUpdate: (properties: Partial<LayerProperties>) => void;
  onAddKeyframe: () => void;
  onDelete: () => void;
  onClose: () => void;
}
```

---

## Layer Panel

A sidebar showing all layers with visibility toggles.

```
┌─────────────────────────┐
│  Layers            [+]  │
├─────────────────────────┤
│  👁 🔦 Highlight 1      │
│  👁 📝 Player Name      │
│  👁 ⚽ Ball Glow        │
│  👁 👁 Scan Indicator   │
│  ○ ❌ Defender #1       │  <- hidden (👁 → ○)
│  ○ ❌ Defender #2       │
│  👁 ➡️ Through Ball     │
└─────────────────────────┘
```

---

## Implementation Steps

### Step 1: Layer Architecture

Create base layer system:

```javascript
// src/frontend/src/modes/overlay/layers/BaseLayer.js

export class BaseLayerController {
  constructor(type, defaultProperties) {
    this.type = type;
    this.defaultProperties = defaultProperties;
  }

  createLayer(id, name) {
    return {
      id,
      type: this.type,
      name,
      visible: true,
      locked: false,
      zIndex: 0,
      keyframes: [],
      properties: { ...this.defaultProperties },
    };
  }

  interpolate(layer, time, framerate) {
    // Interpolate properties between keyframes
  }

  render(layer, ctx, videoMetadata) {
    // Override in subclass
  }
}
```

### Step 2: Layer Context

```javascript
// src/frontend/src/modes/overlay/contexts/LayersContext.jsx

const LayersContext = createContext();

function LayersProvider({ children }) {
  const [layers, setLayers] = useState([]);
  const [selectedLayerId, setSelectedLayerId] = useState(null);

  const addLayer = (type, name) => {
    const controller = LayerRegistry[type];
    const layer = controller.createLayer(uuid(), name);
    setLayers(prev => [...prev, layer]);
    setSelectedLayerId(layer.id);
  };

  const updateLayerProperties = (layerId, properties) => {
    setLayers(prev => prev.map(l =>
      l.id === layerId
        ? { ...l, properties: { ...l.properties, ...properties } }
        : l
    ));
  };

  const addKeyframe = (layerId, time, properties) => {
    // ...
  };

  // ... more methods

  return (
    <LayersContext.Provider value={{
      layers,
      selectedLayerId,
      addLayer,
      updateLayerProperties,
      addKeyframe,
      // ...
    }}>
      {children}
    </LayersContext.Provider>
  );
}
```

### Step 3: Properties Dialog Component

```javascript
// src/frontend/src/modes/overlay/components/PropertiesDialog.jsx

function PropertiesDialog({ layer, onUpdate, onClose }) {
  const PropertyEditor = PropertyEditorRegistry[layer.type];

  return (
    <Dialog open onClose={onClose}>
      <DialogTitle>
        {LayerRegistry[layer.type].icon} {layer.name}
      </DialogTitle>

      <DialogContent>
        <PropertyEditor
          properties={layer.properties}
          onChange={onUpdate}
        />

        <KeyframeControls layer={layer} />
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose}>Done</Button>
      </DialogActions>
    </Dialog>
  );
}
```

### Step 4: Individual Layer Renderers

```javascript
// src/frontend/src/modes/overlay/layers/TextLayer.jsx

export function TextLayerRenderer({ layer, videoMetadata }) {
  const { x, y, text, fontSize, color, opacity } = layer.properties;

  const pixelX = x * videoMetadata.width;
  const pixelY = y * videoMetadata.height;

  return (
    <text
      x={pixelX}
      y={pixelY}
      fontSize={fontSize}
      fill={color}
      opacity={opacity}
      fontWeight="bold"
      textAnchor="middle"
    >
      {text}
    </text>
  );
}
```

### Step 5: Export Integration

Update backend to render all layer types:

```python
# Backend: routers/export.py

def render_overlay_layers(frame, layers, frame_time):
    """Apply all overlay effects to a frame"""

    for layer in layers:
        if not layer['visible']:
            continue

        # Interpolate properties for this frame
        props = interpolate_layer_properties(layer, frame_time)

        # Render based on type
        if layer['type'] == 'highlight':
            frame = render_highlight(frame, props)
        elif layer['type'] == 'text':
            frame = render_text(frame, props)
        elif layer['type'] == 'ball_effect':
            frame = render_ball_effect(frame, props)
        # ... more types

    return frame
```

---

## Export Data Structure

```json
{
  "layers": [
    {
      "id": "layer-1",
      "type": "highlight",
      "name": "Player Highlight",
      "visible": true,
      "zIndex": 0,
      "keyframes": [
        { "time": 0.0, "x": 0.3, "y": 0.5, "radiusX": 0.1, "radiusY": 0.15 },
        { "time": 2.0, "x": 0.7, "y": 0.4, "radiusX": 0.12, "radiusY": 0.18 }
      ]
    },
    {
      "id": "layer-2",
      "type": "text",
      "name": "Player Name",
      "visible": true,
      "zIndex": 1,
      "keyframes": [
        { "time": 0.0, "x": 0.3, "y": 0.65, "text": "Messi", "fontSize": 24 }
      ]
    },
    {
      "id": "layer-3",
      "type": "defender_marker",
      "name": "Beaten Defender",
      "visible": true,
      "zIndex": 2,
      "keyframes": [
        { "time": 1.5, "x": 0.5, "y": 0.6, "size": 30, "label": "#1" }
      ]
    }
  ]
}
```

---

## Testing Requirements

### Unit Tests

- [ ] Layer creation for each type
- [ ] Property interpolation between keyframes
- [ ] Layer visibility toggle
- [ ] Z-index ordering
- [ ] Properties dialog validation

### Integration Tests

- [ ] Add multiple layer types, export, verify rendered
- [ ] Keyframe animation for each layer type
- [ ] Layer reordering affects render order

### Manual Tests

- [ ] Properties dialog is intuitive
- [ ] Click-to-select layers works
- [ ] Visibility toggles work in real-time
- [ ] All layer types render correctly in export

---

## Acceptance Criteria

1. **Common Interface**: All layer types use same add/edit/delete workflow
2. **Properties Dialog**: Click layer opens editable properties panel
3. **Visibility Toggle**: Each layer can be shown/hidden
4. **At Least 3 Types**: Highlight, Text, and one soccer-specific type working
5. **Keyframe Animation**: Can animate position/properties for any layer
6. **Export Rendering**: All visible layers render correctly in final video
7. **Layer Panel**: Sidebar shows all layers with icons and toggles

---

## Future Considerations

- Layer groups (organize related layers)
- Layer templates (save/load common configurations)
- Auto-tracking (computer vision to follow ball/player)
- Presets for common soccer visualizations
