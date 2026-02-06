# mvc-container-handlers

**Priority:** CRITICAL
**Category:** Container Layer

## Rule
Containers define all event handlers and pass them to Views. Views only receive and call handlers, never define them.

## Rationale
When handlers are defined in views:
1. Business logic leaks into presentation
2. Testing requires rendering the full view
3. Handler logic can't be reused across views
4. Debugging requires looking at multiple layers

## Incorrect Example

```jsx
// CropView.jsx
function CropView({ crop, onCropChange, videoRef }) {
  // BAD: Handler logic in view
  const handleDrag = (e) => {
    const bounds = videoRef.current.getBoundingClientRect();
    const x = (e.clientX - bounds.left) / bounds.width;
    const y = (e.clientY - bounds.top) / bounds.height;

    // Complex clamping logic
    const clampedX = Math.max(0, Math.min(1, x));
    const clampedY = Math.max(0, Math.min(1, y));

    // Aspect ratio calculation
    const aspectRatio = 9 / 16;
    const adjustedWidth = crop.width;
    const adjustedHeight = adjustedWidth * aspectRatio;

    onCropChange({
      x: clampedX,
      y: clampedY,
      width: adjustedWidth,
      height: adjustedHeight
    });
  };

  return (
    <div className="crop-overlay" onMouseMove={handleDrag}>
      {/* Crop UI */}
    </div>
  );
}
```

**Why this is wrong:**
- Coordinate transformation logic is in the view
- Clamping and aspect ratio logic is presentation-coupled
- `videoRef` is passed down just for calculations
- Testing this view requires mocking DOM measurements

## Correct Example

```jsx
// CropContainer.jsx
function CropContainer({ crop, video }) {
  const videoRef = useRef(null);

  // GOOD: Container defines handler with all logic
  const handleDrag = useCallback((e) => {
    if (!videoRef.current) return;

    const bounds = videoRef.current.getBoundingClientRect();
    const rawX = (e.clientX - bounds.left) / bounds.width;
    const rawY = (e.clientY - bounds.top) / bounds.height;

    // Clamp to valid range
    const x = Math.max(0, Math.min(1, rawX));
    const y = Math.max(0, Math.min(1, rawY));

    // Maintain aspect ratio
    const aspectRatio = 9 / 16;
    const width = crop.width;
    const height = width * aspectRatio;

    crop.updatePosition({ x, y, width, height });
  }, [crop]);

  const handleDragEnd = useCallback(() => {
    crop.commitKeyframe(video.currentFrame);
  }, [crop, video.currentFrame]);

  return (
    <div ref={videoRef}>
      <CropView
        cropBounds={crop.state}
        onDrag={handleDrag}
        onDragEnd={handleDragEnd}
      />
    </div>
  );
}

// CropView.jsx
function CropView({ cropBounds, onDrag, onDragEnd }) {
  // GOOD: View only calls handlers, no logic
  return (
    <div
      className="crop-overlay"
      onMouseMove={onDrag}
      onMouseUp={onDragEnd}
    >
      <div
        className="crop-box"
        style={{
          left: `${cropBounds.x * 100}%`,
          top: `${cropBounds.y * 100}%`,
          width: `${cropBounds.width * 100}%`,
          height: `${cropBounds.height * 100}%`
        }}
      />
    </div>
  );
}
```

## Additional Context

### Handler naming convention:
- Container defines: `handleXxx` (e.g., `handleDrag`, `handleCropChange`)
- View receives: `onXxx` (e.g., `onDrag`, `onCropChange`)

### What containers handle:
- Coordinate transformations
- Validation and clamping
- State updates
- API calls
- Side effects

### What views do with handlers:
- Attach to DOM events
- Pass to child components
- Call on user interaction

### Testing benefit:
```jsx
// Easy to test container logic in isolation
const mockCrop = { updatePosition: jest.fn(), commitKeyframe: jest.fn() };
const { handleDrag } = renderHook(() =>
  useCropHandlers(mockCrop, mockVideo)
);

handleDrag({ clientX: 100, clientY: 100 });
expect(mockCrop.updatePosition).toHaveBeenCalledWith({
  x: 0.5, y: 0.5, width: 0.8, height: 0.45
});
```
