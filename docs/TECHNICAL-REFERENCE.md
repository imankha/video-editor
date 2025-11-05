# Technical Reference

Comprehensive technical documentation for the video editor project.

---

## Technology Stack

### Frontend Framework
- **React 18+**: Component-based UI
- **Vite**: Build tool and dev server
- **JavaScript/TypeScript**: Programming language

### Video Processing
- **HTML5 Video API**: Playback control
- **Canvas API**: Frame manipulation, crop rendering
- **FFmpeg.wasm**: Video encoding/decoding
- **Web Audio API**: Audio processing, pitch control

### State Management
- **React Context**: Global state
- **React Hooks**: Local state and side effects
- **Custom Hooks**: Reusable logic

### Utilities
- **UUID**: Unique ID generation
- **Date-fns**: Time formatting
- **Lodash**: Utility functions (optional)

---

## Architecture Patterns

### Component Structure
```
src/
├── components/        # React components
├── hooks/            # Custom React hooks
├── services/         # Business logic
├── utils/            # Pure utility functions
├── types/            # TypeScript types
├── workers/          # Web Workers
└── styles/           # CSS files
```

### State Management Pattern
```javascript
// Single source of truth in React Context
const AppContext = createContext();

// Custom hook for accessing state
function useApp() {
  return useContext(AppContext);
}

// Provider wraps entire app
<AppProvider>
  <App />
</AppProvider>
```

### Separation of Concerns
- Components: Only UI rendering
- Hooks: State management and side effects
- Services: Business logic (export, video processing)
- Utils: Pure functions (calculations, formatting)

---

## Key Algorithms

### Time Conversion
```javascript
// Convert between different time representations
timeToPixel(time, duration, width)
pixelToTime(pixel, duration, width)
frameToTime(frame, framerate)
timeToFrame(time, framerate)
```

### Interpolation
```javascript
// Linear interpolation
lerp(start, end, progress) = start + (end - start) * progress

// Easing functions
easeInOut(t) = t < 0.5 
  ? 2 * t * t 
  : 1 - Math.pow(-2 * t + 2, 2) / 2

// Bezier interpolation
cubicBezier(t, p0, p1, p2, p3)
```

### Crop Calculations
```javascript
// Interpolate between two crop rectangles
interpolateCrop(crop1, crop2, progress) {
  return {
    x: lerp(crop1.x, crop2.x, progress),
    y: lerp(crop1.y, crop2.y, progress),
    width: lerp(crop1.width, crop2.width, progress),
    height: lerp(crop1.height, crop2.height, progress)
  };
}
```

---

## Performance Considerations

### Rendering Optimization
- Use `React.memo` for expensive components
- Use `useMemo` for expensive calculations
- Use `useCallback` to prevent unnecessary re-renders
- Virtualize long lists (clip list, keyframe list)

### Video Performance
- Use lower resolution proxy for preview
- Limit crop overlay updates (throttle to 30-60fps)
- Offload processing to Web Workers
- Use hardware acceleration when available

### Memory Management
- Revoke blob URLs when done
- Clean up event listeners
- Cancel in-flight requests on unmount
- Limit number of simultaneous video elements

---

## Data Persistence

### Local Storage
```javascript
// Save project state
localStorage.setItem('video-editor-project', JSON.stringify(state));

// Load project state
const saved = JSON.parse(localStorage.getItem('video-editor-project'));
```

### Auto-save Strategy
```javascript
// Debounced auto-save
const autoSave = useMemo(
  () => debounce((state) => {
    localStorage.setItem('autosave', JSON.stringify(state));
  }, 2000),
  []
);

useEffect(() => {
  autoSave(state);
}, [state]);
```

---

## Error Handling

### Error Boundary
```javascript
class ErrorBoundary extends React.Component {
  state = { hasError: false, error: null };
  
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  
  render() {
    if (this.state.hasError) {
      return <ErrorDisplay error={this.state.error} />;
    }
    return this.props.children;
  }
}
```

### Async Error Handling
```javascript
try {
  const result = await exportVideo(config);
} catch (error) {
  if (error.code === 'INSUFFICIENT_STORAGE') {
    showError('Not enough disk space');
  } else if (error.code === 'FFMPEG_ERROR') {
    showError('Video encoding failed');
  } else {
    showError('An unexpected error occurred');
  }
}
```

---

## Testing Strategy

### Unit Tests
```javascript
// Test utility functions
import { lerp, timeToPixel } from './utils';

test('lerp interpolates correctly', () => {
  expect(lerp(0, 100, 0.5)).toBe(50);
});

test('timeToPixel converts correctly', () => {
  expect(timeToPixel(5, 10, 100)).toBe(50);
});
```

### Component Tests
```javascript
import { render, screen } from '@testing-library/react';
import VideoPlayer from './VideoPlayer';

test('renders play button', () => {
  render(<VideoPlayer />);
  expect(screen.getByRole('button', { name: /play/i })).toBeInTheDocument();
});
```

### E2E Tests
```javascript
test('full export workflow', async ({ page }) => {
  await page.goto('http://localhost:5173');
  await page.setInputFiles('input[type="file"]', 'test.mp4');
  await page.click('button:has-text("Export")');
  await page.waitForSelector('text=Export complete');
});
```

---

## Debugging Tips

### Video Element Debugging
```javascript
// Log all video events
const video = videoRef.current;
['loadstart', 'loadedmetadata', 'canplay', 'play', 'pause', 
 'seeking', 'seeked', 'timeupdate', 'ended', 'error'].forEach(event => {
  video.addEventListener(event, () => console.log(`[Video] ${event}`));
});
```

### Performance Profiling
```javascript
// Measure operation time
console.time('Export');
await exportVideo(config);
console.timeEnd('Export');

// React DevTools Profiler
<Profiler id="Timeline" onRender={logRenderTime}>
  <Timeline />
</Profiler>
```

---

## Common Pitfalls

### Pitfall 1: Blob URL Memory Leaks
```javascript
// ❌ Bad: Never revoked
const url = URL.createObjectURL(file);
video.src = url;

// ✅ Good: Revoke when done
useEffect(() => {
  const url = URL.createObjectURL(file);
  video.src = url;
  return () => URL.revokeObjectURL(url);
}, [file]);
```

### Pitfall 2: State Updates in Loops
```javascript
// ❌ Bad: Too many re-renders
for (let i = 0; i < 100; i++) {
  setProgress(i);
}

// ✅ Good: Batch updates
const newProgress = [];
for (let i = 0; i < 100; i++) {
  newProgress.push(i);
}
setProgress(newProgress[newProgress.length - 1]);
```

### Pitfall 3: Not Cleaning Up Event Listeners
```javascript
// ❌ Bad: Memory leak
useEffect(() => {
  window.addEventListener('resize', handleResize);
});

// ✅ Good: Cleanup
useEffect(() => {
  window.addEventListener('resize', handleResize);
  return () => window.removeEventListener('resize', handleResize);
}, []);
```

---

## Security Considerations

### File Handling
- Validate file types on client
- Check file sizes before loading
- Sanitize filenames
- Don't trust client-side validation (if backend exists)

### XSS Prevention
- Never use `dangerouslySetInnerHTML` with user input
- Sanitize any user-generated content
- Use Content Security Policy headers

### CORS Headers
```javascript
// Required for SharedArrayBuffer in FFmpeg
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Opener-Policy: same-origin
```

---

## Browser Compatibility

### Feature Detection
```javascript
// Check if feature is supported
const hasFileSystem = 'showOpenFilePicker' in window;
const hasWebGL = !!document.createElement('canvas').getContext('webgl');
```

### Polyfills
```javascript
// Import polyfills only if needed
if (!window.requestIdleCallback) {
  await import('requestidlecallback-polyfill');
}
```

---

## Useful Resources

### Documentation
- MDN Web Docs: https://developer.mozilla.org
- React Docs: https://react.dev
- FFmpeg.wasm: https://ffmpegwasm.netlify.app

### Tools
- Can I Use: https://caniuse.com
- Bundlephobia: https://bundlephobia.com
- WebPageTest: https://www.webpagetest.org

### Libraries
- date-fns: Time formatting
- uuid: Unique IDs
- lodash: Utilities
