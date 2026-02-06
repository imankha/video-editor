# data-path-all-conditions

**Priority:** MEDIUM
**Category:** Path Coverage

## Rule
When a component requires multiple conditions to render (e.g., `videoUrl && cropState && metadata`), ALL code paths that render it must satisfy ALL conditions.

## Rationale
Different entry points to a feature may provide different data:
1. File upload provides metadata immediately
2. Streaming URLs may not have pre-loaded metadata
3. Clip switching may have cached vs. fresh data
4. Mode navigation may have partial state

If any path misses a condition, the component crashes or behaves incorrectly.

## Incorrect Example

```jsx
function FramingScreen() {
  const { videoUrl, streamingUrl } = useVideoSource();
  const { metadata } = useMetadata();
  const crop = useCrop(metadata);

  // BAD: Streaming path bypasses metadata
  const effectiveUrl = videoUrl || streamingUrl;

  return (
    <div>
      {effectiveUrl && (
        // CropOverlay needs metadata, but streaming path may not have it
        <CropOverlay
          url={effectiveUrl}
          crop={crop.state}
          metadata={metadata}  // May be undefined for streaming!
        />
      )}
    </div>
  );
}
```

**Why this is wrong:**
- When using `streamingUrl`, metadata may not exist yet
- The guard only checks `effectiveUrl`, not all required data
- CropOverlay crashes with "Cannot read property 'width' of undefined"

## Correct Example

```jsx
function FramingScreen() {
  const { videoUrl, streamingUrl } = useVideoSource();
  const { metadata, extractFromVideo } = useMetadata();
  const videoRef = useRef(null);
  const crop = useCrop(metadata);

  const effectiveUrl = videoUrl || streamingUrl;

  // Handle metadata extraction for streaming URLs
  const handleLoadedMetadata = useCallback(() => {
    if (!metadata && videoRef.current) {
      extractFromVideo(videoRef.current);
    }
  }, [metadata, extractFromVideo]);

  // Guard ALL conditions
  const canRenderCrop = effectiveUrl && metadata && crop.isInitialized;

  return (
    <div>
      <video
        ref={videoRef}
        src={effectiveUrl}
        onLoadedMetadata={handleLoadedMetadata}
      />

      {canRenderCrop && (
        <CropOverlay
          url={effectiveUrl}
          crop={crop.state}
          metadata={metadata}
        />
      )}
    </div>
  );
}
```

## Additional Context

To ensure all paths are covered:

1. **List all entry points** to the feature (upload, streaming, clip switch, etc.)
2. **List all required data** for the component (url, metadata, state, etc.)
3. **Verify each entry point** provides or loads all required data
4. **Add fallbacks** where data may be loaded asynchronously (like `handleLoadedMetadata`)

Testing checklist:
- [ ] Upload a file and navigate to framing
- [ ] Use a streaming URL and navigate to framing
- [ ] Switch between clips in framing mode
- [ ] Navigate away and back to framing mode
