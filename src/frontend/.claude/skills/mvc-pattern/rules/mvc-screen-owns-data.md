# mvc-screen-owns-data

**Priority:** CRITICAL
**Category:** Screen Layer

## Rule
Screens own all hooks and ensure data is loaded. They are the single point of data initialization for a feature.

## Rationale
When data initialization is scattered across components:
1. Loading states become inconsistent
2. Race conditions occur when multiple components fetch the same data
3. Debugging requires tracing through many files
4. Refactoring becomes risky

## Incorrect Example

```jsx
// FramingScreen.jsx
function FramingScreen() {
  return (
    <div className="framing-layout">
      <Sidebar />
      <FramingContainer />  {/* Container fetches its own data */}
    </div>
  );
}

// FramingContainer.jsx
function FramingContainer() {
  // BAD: Container owns data
  const video = useVideo();
  const crop = useCrop(video.metadata);
  const { clips } = useClipStore();

  if (!video.isReady) {
    return <Loading />;  // Loading state deep in the tree
  }

  return <FramingView crop={crop.state} clips={clips} />;
}
```

**Why this is wrong:**
- The Screen doesn't know if data is ready
- Loading state is hidden inside Container
- Screen can't coordinate between Sidebar and Container
- Adding more containers means more scattered loading states

## Correct Example

```jsx
// FramingScreen.jsx
function FramingScreen() {
  // GOOD: Screen owns ALL data hooks
  const video = useVideo();
  const crop = useCrop(video.metadata);
  const { clips, selectedClip } = useClipStore();

  // Screen handles the loading state
  if (!video.isReady) {
    return <FullScreenLoader />;
  }

  return (
    <div className="framing-layout">
      <Sidebar clips={clips} selectedId={selectedClip?.id} />
      <FramingContainer
        video={video}
        crop={crop}
        selectedClip={selectedClip}
      />
    </div>
  );
}

// FramingContainer.jsx
function FramingContainer({ video, crop, selectedClip }) {
  // GOOD: Container receives data as props
  const handleCropChange = useCallback((newCrop) => {
    crop.updateKeyframe(video.currentFrame, newCrop);
  }, [crop, video.currentFrame]);

  return (
    <FramingView
      crop={crop.state}
      clipName={selectedClip.name}
      onCropChange={handleCropChange}
    />
  );
}
```

## Additional Context

Benefits of screen-owned data:
1. **Single loading state**: One place to show loading UI
2. **Coordinated rendering**: All children get data at the same time
3. **Clear dependencies**: Screen file shows all data requirements
4. **Easier testing**: Mock data at screen level for integration tests

Screen structure pattern:
```jsx
function SomeScreen() {
  // 1. All hooks at the top
  const dataA = useHookA();
  const dataB = useHookB();
  const dataC = useHookC();

  // 2. Loading guard
  if (!dataA.isReady || !dataB.isReady) {
    return <Loading />;
  }

  // 3. Render with guaranteed data
  return (
    <Container dataA={dataA} dataB={dataB} dataC={dataC} />
  );
}
```
