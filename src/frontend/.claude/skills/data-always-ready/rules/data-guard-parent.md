# data-guard-parent

**Priority:** CRITICAL
**Category:** Parent Guarding

## Rule
Parent components must verify data exists before rendering children. Children assume their props are always defined.

## Rationale
When components check for their own data internally, it creates:
1. Inconsistent loading state handling across the app
2. Defensive code that obscures the real component logic
3. Race conditions when data arrives in unexpected orders
4. Harder debugging when "undefined" errors occur deep in the tree

## Incorrect Example

```jsx
// ClipEditor.jsx
function ClipEditor({ clip }) {
  // BAD: Component checks its own data
  if (!clip) {
    return <Loading />;
  }

  if (!clip.metadata) {
    return <div>Loading metadata...</div>;
  }

  return (
    <div>
      <h2>{clip.name}</h2>
      <VideoPlayer src={clip.url} metadata={clip.metadata} />
    </div>
  );
}
```

**Why this is wrong:**
- The component has multiple loading states scattered throughout
- If `clip` is unexpectedly undefined in production, the loading spinner masks the bug
- The parent doesn't know what state the child is in

## Correct Example

```jsx
// ParentScreen.jsx
function FramingScreen() {
  const { selectedClip, isLoading } = useClipStore();

  // Screen handles ALL loading states
  if (isLoading) {
    return <FullScreenLoader />;
  }

  return (
    <div className="framing-layout">
      {/* Guard BEFORE rendering */}
      {selectedClip && selectedClip.metadata && (
        <ClipEditor clip={selectedClip} />
      )}
    </div>
  );
}

// ClipEditor.jsx
function ClipEditor({ clip }) {
  // GOOD: Component assumes data is ready
  return (
    <div>
      <h2>{clip.name}</h2>
      <VideoPlayer src={clip.url} metadata={clip.metadata} />
    </div>
  );
}
```

## Additional Context

This pattern aligns with the Screen → Container → View architecture:
- **Screens** own all loading logic and data guards
- **Containers** receive guaranteed data, handle logic
- **Views** are pure presentation with no null checks

When a component crashes due to undefined props, the bug is visible immediately and points to the parent that failed to guard properly.
