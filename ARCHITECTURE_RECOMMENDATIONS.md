# Architecture Analysis & Recommendations

## Current Issues

### 1. **Data Contamination in CropOverlay** ⚠️ CRITICAL

**Problem**: `CropOverlay.jsx:273` calls `onCropComplete(currentCrop)` where `currentCrop` includes the `time` property from interpolated state.

```javascript
// Current (BAD):
onCropComplete(currentCrop);  // Sends {time, x, y, width, height}

// Should be (GOOD):
onCropComplete({
  x: currentCrop.x,
  y: currentCrop.y,
  width: currentCrop.width,
  height: currentCrop.height
});
```

**Impact**: This caused the keyframe time overwrite bug we just fixed. The component shouldn't know about time - it only handles spatial data.

**Fix**: CropOverlay should only emit spatial properties (x, y, width, height). Time is managed at the App level.

---

### 2. **Circular State Updates** ⚠️ HIGH PRIORITY

**Current Flow**:
1. User drags → `handleCropChange(newCrop)` → sets `currentCropState`
2. User releases → `handleCropComplete(cropData)` → calls `addOrUpdateKeyframe`
3. `keyframes` state updates
4. `useEffect` triggers → calls `interpolateCrop(currentTime)`
5. Sets `currentCropState` again → **potential race condition**

**Problem**: `currentCropState` is both:
- Set directly during drag (lines App.jsx:76-78)
- Derived from keyframes (lines App.jsx:96-110)

This creates multiple sources of truth.

**Recommended Architecture**:
```javascript
// INSTEAD OF: Managing currentCropState independently
const [currentCropState, setCurrentCropState] = useState(null);

// USE: Derive it from model
const currentCropState = useMemo(() => {
  if (keyframes.length === 0) return null;
  return interpolateCrop(currentTime);
}, [keyframes, currentTime, interpolateCrop]);
```

**Benefits**:
- Single source of truth (keyframes)
- No race conditions
- Simpler mental model
- Fewer bugs

---

### 3. **Prop Drilling** ⚠️ MEDIUM PRIORITY

**Problem**: `isEndKeyframeExplicit` is passed through 3 layers:
```
App.jsx → Timeline.jsx → CropLayer.jsx
```

**Recommendation**: Consider React Context for shared crop state:

```javascript
// CropContext.js
const CropContext = createContext();

export function CropProvider({ children, metadata }) {
  const cropState = useCrop(metadata);
  return (
    <CropContext.Provider value={cropState}>
      {children}
    </CropContext.Provider>
  );
}

export function useCropContext() {
  return useContext(CropContext);
}
```

**Benefits**:
- No prop drilling
- Cleaner component APIs
- Easier to add crop-related features

---

### 4. **CropOverlay Knows Too Much** ⚠️ MEDIUM PRIORITY

**Problem**: CropOverlay receives and manages `currentCrop` which includes `time`. It shouldn't care about time.

**Better Separation of Concerns**:

```javascript
// CropOverlay should ONLY handle:
// - Spatial coordinates (x, y, width, height)
// - Video dimensions (for constraints)
// - Aspect ratio (for resize constraints)

// App level should handle:
// - Time management
// - Keyframe creation
// - Interpolation

<CropOverlay
  videoMetadata={metadata}
  cropRect={{ x, y, width, height }}  // No time!
  aspectRatio={aspectRatio}
  onCropChange={(rect) => { /* during drag */ }}
  onCropComplete={(rect) => {
    // App adds time here
    addOrUpdateKeyframe(currentTime, rect);
  }}
/>
```

---

### 5. **FFmpeg Error Handling** ⚠️ HIGH PRIORITY

**Problem**: Lines 308-320 in main.py try to parse crop filter string with fragile string splitting:
```python
w=crop_filter.split('w=')[1].split(':')[0]  # Brittle!
```

**Recommendation**: Return structured data from `generate_crop_filter`:

```python
def generate_crop_filter(keyframes, duration, fps):
    """Returns both filter string AND structured params"""
    # ... build expressions ...

    return {
        'filter_string': f"crop=w={w_expr}:h={h_expr}:x={x_expr}:y={y_expr}",
        'width_expr': w_expr,
        'height_expr': h_expr,
        'x_expr': x_expr,
        'y_expr': y_expr
    }

# Then use:
stream = ffmpeg.filter(stream, 'crop',
                      w=crop_params['width_expr'],
                      h=crop_params['height_expr'],
                      ...)
```

---

## Environment Configuration

### Backend
Set environment variable:
```bash
# Development
ENV=development python -m uvicorn app.main:app --reload

# Production
ENV=production python -m uvicorn app.main:app
```

### Frontend
Build commands:
```bash
# Development
npm run dev  # Sets NODE_ENV=development

# Production
npm run build  # Sets NODE_ENV=production
```

**Features by Environment**:

| Feature | Development | Production |
|---------|------------|------------|
| Debug Badge | ✅ Visible | ❌ Hidden |
| Stack Traces | ✅ Full details | ❌ Sanitized |
| Error Messages | ✅ Detailed | ❌ Generic |
| Console Logs | ✅ Verbose | ⚠️ Minimal |

---

## Recommended Refactoring Priority

1. **CRITICAL**: Fix data contamination in CropOverlay (extract only x,y,width,height)
2. **HIGH**: Make currentCropState derived instead of managed
3. **HIGH**: Improve FFmpeg filter generation (structured return)
4. **MEDIUM**: Introduce CropContext to eliminate prop drilling
5. **MEDIUM**: Separate time management from CropOverlay

---

## Testing Recommendations

1. **Unit tests** for interpolateCrop logic
2. **Integration tests** for keyframe creation/update/delete
3. **E2E tests** for:
   - Drag crop rectangle
   - Create keyframe
   - Verify keyframe appears
   - Export video
   - Verify cropped output

---

## Summary

The main architectural flaw is **mixing concerns**:
- CropOverlay handles both spatial AND temporal data
- currentCropState has two sources of truth
- Error boundaries don't catch enough errors

**Golden Rule**:
> UI components should **display** state, not **manage** it.
> The model (keyframes) should be the single source of truth.

By making `currentCropState` derived from `keyframes + currentTime`, we eliminate race conditions and simplify the mental model.
