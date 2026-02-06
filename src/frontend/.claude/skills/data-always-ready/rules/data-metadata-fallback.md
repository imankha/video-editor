# data-metadata-fallback

**Priority:** MEDIUM
**Category:** Path Coverage

## Rule
For streaming URLs, video metadata may not be pre-loaded. Use `handleLoadedMetadata` to extract metadata from the video element as a fallback.

## Rationale
Different video sources have different metadata availability:
- **File upload**: Metadata extracted during upload
- **Streaming URL**: No pre-extraction, must wait for video to load
- **Cached clip**: Metadata in database

If code assumes metadata is always available, streaming URLs break.

## Incorrect Example

```javascript
function FramingScreen() {
  const { videoUrl, metadata } = useVideoSource();

  // BAD: Assumes metadata always exists
  const crop = useCrop(metadata);  // metadata is undefined for streaming!

  return (
    <div>
      <video src={videoUrl} />
      <CropOverlay
        metadata={metadata}  // undefined!
        crop={crop.state}    // crashes: can't read width of undefined
      />
    </div>
  );
}
```

**Why this is wrong:**
- Streaming URLs don't have pre-extracted metadata
- `useCrop(undefined)` initializes with undefined dimensions
- `CropOverlay` crashes when trying to use `metadata.width`

## Correct Example

```javascript
function FramingScreen() {
  const { videoUrl, metadata, extractFromVideo } = useVideoSource();
  const videoRef = useRef(null);

  // Fallback extraction for streaming URLs
  const handleLoadedMetadata = useCallback(() => {
    if (!metadata && videoRef.current) {
      const video = videoRef.current;
      extractFromVideo({
        width: video.videoWidth,
        height: video.videoHeight,
        duration: video.duration,
        framerate: 30  // Default, can't detect from video element
      });
    }
  }, [metadata, extractFromVideo]);

  // Guard: only render crop when metadata exists
  const crop = useCrop(metadata);

  return (
    <div>
      <video
        ref={videoRef}
        src={videoUrl}
        onLoadedMetadata={handleLoadedMetadata}
      />
      {metadata && crop.isInitialized && (
        <CropOverlay
          metadata={metadata}
          crop={crop.state}
        />
      )}
    </div>
  );
}
```

## Implementation in useVideo

```javascript
function useVideo() {
  const [metadata, setMetadata] = useState(null);

  const extractFromVideo = useCallback((extractedMetadata) => {
    setMetadata(extractedMetadata);
  }, []);

  const handleLoadedMetadata = useCallback((event) => {
    if (!metadata) {
      const video = event.target;
      extractFromVideo({
        width: video.videoWidth,
        height: video.videoHeight,
        duration: video.duration,
        framerate: 30
      });
    }
  }, [metadata, extractFromVideo]);

  return {
    metadata,
    handleLoadedMetadata,
    extractFromVideo
  };
}
```

## Additional Context

Entry points that need this fallback:
- Streaming URLs pasted into input
- Direct URL navigation
- Shared links

Entry points that already have metadata:
- File upload
- Clip selection from sidebar
- Cached database records

Always test both paths when working with video metadata.
