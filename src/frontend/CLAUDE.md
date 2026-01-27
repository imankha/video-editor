# Frontend Guidelines

## Stack
React 18 + Vite + Zustand + Tailwind

## Testing
```bash
npm test                    # Unit tests (Vitest)
npm run test:e2e           # E2E tests (Playwright) - start servers first!
npm run test:e2e -- --ui   # E2E with visual UI
```

## Architecture: Data Always Ready + MVC

### Screen → Container → View Pattern
```
Screen (data fetching, hook initialization)
  └── Container (state logic, event handlers)
        └── View (presentational, props only)
```

**Screens** own hooks and ensure data is loaded before rendering children.
**Containers** receive data as props, manage derived state and handlers.
**Views** are pure presentation - no hooks, no data fetching.

### Data Always Ready
Components should never render loading states internally. Parent ensures data exists:
```jsx
// Good - parent guards
{selectedClip && <ClipEditor clip={selectedClip} />}

// Bad - child checks
function ClipEditor({ clip }) {
  if (!clip) return <Loading />;  // Don't do this
}
```

## State Management
- **Zustand stores**: Global state (`editorStore`, `exportStore`, etc.)
- **Screen-owned hooks**: Each screen initializes `useVideo`, `useCrop`, etc.
- **No prop drilling from App.jsx**: Screens are self-contained

## Keyframes
```javascript
keyframe = {
  frame: number,                    // Frame-based, not time
  origin: 'permanent' | 'user' | 'trim',
  // + mode-specific data (x, y, width, height for crop)
}
```

## Common Pitfalls

### All code paths must provide required data
When a component has multiple conditions (e.g., `videoUrl && cropState && metadata`), ensure ALL code paths that render it satisfy ALL conditions. Example: streaming URLs bypassed metadata extraction, breaking CropOverlay.

### Prop-based data flow over timing flags
Pass saved state as props and let hooks restore via effects:
```jsx
// Good - prop-based
useCrop(metadata, trimRange, selectedClip?.cropKeyframes)

// Bad - timing-dependent manual calls
useEffect(() => {
  if (justSwitchedClip) restoreCropState(clip.keyframes);
}, [clip]);
```

### Test all entry points
The same feature may be reached via different paths (file upload, clip switch, mode navigation). Each path may have different data available. Test them all.

### Video metadata fallback
For streaming URLs, metadata may not be pre-loaded. `useVideo.handleLoadedMetadata` extracts it from the video element as a fallback.

## Don't
- Don't add console.logs in committed code
- Don't fetch data in View components
- Don't render components without data guards
