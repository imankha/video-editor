# data-prop-flow

**Priority:** HIGH
**Category:** Prop Flow

## Rule
Pass saved state as props to hooks. Let hooks restore state via effects internally, rather than calling restoration functions manually with timing flags.

## Rationale
Timing-dependent manual calls create:
1. Race conditions when events fire in unexpected orders
2. Brittle code that breaks when data flow changes
3. Scattered restoration logic across components
4. Difficult-to-debug state sync issues

## Incorrect Example

```jsx
function FramingContainer({ selectedClip }) {
  const crop = useCrop();
  const [justSwitchedClip, setJustSwitchedClip] = useState(false);

  // BAD: Manual restoration with timing flags
  useEffect(() => {
    if (selectedClip) {
      setJustSwitchedClip(true);
    }
  }, [selectedClip?.id]);

  useEffect(() => {
    if (justSwitchedClip && selectedClip?.cropKeyframes) {
      crop.restoreKeyframes(selectedClip.cropKeyframes);
      setJustSwitchedClip(false);
    }
  }, [justSwitchedClip, selectedClip, crop]);

  return <CropOverlay crop={crop.state} />;
}
```

**Why this is wrong:**
- Two effects create a timing dependency
- `justSwitchedClip` flag is fragile state management
- If the clip changes rapidly, restoration may be skipped
- Restoration logic is in the component, not the hook

## Correct Example

```jsx
function FramingContainer({ selectedClip, metadata, trimRange }) {
  // GOOD: Pass saved keyframes as initial state to the hook
  const crop = useCrop(metadata, trimRange, selectedClip?.cropKeyframes);

  return <CropOverlay crop={crop.state} />;
}

// In useCrop.js
function useCrop(metadata, trimRange, initialKeyframes) {
  const [keyframes, setKeyframes] = useState([]);

  // Hook handles its own restoration
  useEffect(() => {
    if (initialKeyframes && initialKeyframes.length > 0) {
      setKeyframes(initialKeyframes);
    } else if (metadata) {
      // Initialize with default keyframe
      setKeyframes([createDefaultKeyframe(metadata)]);
    }
  }, [initialKeyframes, metadata]);

  // ... rest of hook
}
```

## Additional Context

This pattern ensures:
1. **Single responsibility**: Hooks manage their own state lifecycle
2. **Predictable flow**: Data flows down as props, hooks react consistently
3. **Testability**: Hooks can be tested with different initial states
4. **Debuggability**: State source is clear (props → hook effect → state)

When switching clips, the parent passes the new clip's keyframes, and the hook handles restoration. No timing flags needed.
