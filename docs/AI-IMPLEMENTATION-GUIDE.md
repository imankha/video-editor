# AI Implementation Guide

Guidelines for implementing the video editor with AI assistance (Claude Code).

---

## How to Use These Specs

### For Each Phase

1. **Read the Phase Overview**
   - Understand the core concept
   - Note the risk level
   - Check dependencies

2. **Study the Features Section**
   - Know what to build
   - Understand user interactions
   - Review UI mockups

3. **Implement Data Models First**
   - Create TypeScript interfaces
   - Set up state structure
   - Validate data shapes

4. **Build Components Incrementally**
   - Start with simplest component
   - Test each component in isolation
   - Build up to complex interactions

5. **Implement Core Algorithms**
   - Copy algorithm pseudocode
   - Add type annotations
   - Write unit tests
   - Optimize if needed

6. **Test Thoroughly**
   - Use the testing checklists
   - Test edge cases
   - Test integration points

---

## Prompting Strategy

### Initial Prompt Template
```
I'm building Phase [N]: [Phase Name] of a video editor.

Core concept: [Concept]

First, I need to implement [specific component/feature].

Here are the requirements:
[paste relevant section from spec]

Please help me:
1. Create the component structure
2. Implement the core logic
3. Add proper TypeScript types
4. Include error handling
```

### Iterative Prompts
```
The [component] is working but needs:
- [specific improvement]
- [specific bug fix]
- [performance optimization]

Current code:
[paste code]

Please help me improve this.
```

### Debugging Prompts
```
I'm getting this error:
[error message]

Context:
[what you were doing]

Relevant code:
[paste code]

What's wrong and how do I fix it?
```

---

## Implementation Order

### Phase 1: Foundation
1. Set up project structure
2. Create basic App component
3. Implement video loading
4. Add video player with controls
5. Create timeline component
6. Add playback controls
7. Test end-to-end

### Phase 2: Crop Keyframes
1. Add crop state management
2. Create crop overlay (static first)
3. Add resize handles (one at a time)
4. Implement handle drag logic
5. Add keyframe data structure
6. Implement keyframe creation
7. Add interpolation algorithm
8. Connect to playback
9. Add properties panel
10. Test thoroughly

### Phase 3: Import/Export
1. Enhance import (multiple formats)
2. Set up FFmpeg.wasm
3. Implement basic export (no crop)
4. Add crop rendering to export
5. Implement progress tracking
6. Create export dialog
7. Test with various videos

### Phase 4: Speed Controls
1. Add speed state management
2. Create speed track component
3. Implement region creation
4. Add speed adjustment
5. Implement time conversion
6. Modify playback for speed
7. Add properties panel
8. Integrate with export

### Phase 5: Timeline Editing
1. Add Clip data model
2. Support multiple clips in state
3. Implement trim handles
4. Add scissors tool
5. Implement clip splitting
6. Add zoom controls
7. Implement snap logic
8. Test multi-clip workflows

---

## Code Organization Best Practices

### File Naming
```
components/VideoPlayer.jsx         # PascalCase for components
hooks/useVideo.js                  # camelCase with 'use' prefix
utils/timeFormat.js                # camelCase for utilities
types/video.ts                     # camelCase for types
```

### Component Structure
```jsx
// 1. Imports
import React, { useState, useEffect } from 'react';
import './VideoPlayer.css';

// 2. Types/Interfaces
interface VideoPlayerProps {
  src: string;
  onTimeUpdate?: (time: number) => void;
}

// 3. Component
export function VideoPlayer({ src, onTimeUpdate }: VideoPlayerProps) {
  // 3a. State
  const [playing, setPlaying] = useState(false);
  
  // 3b. Refs
  const videoRef = useRef<HTMLVideoElement>(null);
  
  // 3c. Effects
  useEffect(() => {
    // Setup and cleanup
  }, []);
  
  // 3d. Event handlers
  const handlePlay = () => {
    setPlaying(true);
  };
  
  // 3e. Render
  return (
    <div className="video-player">
      <video ref={videoRef} src={src} onPlay={handlePlay} />
    </div>
  );
}
```

### Custom Hook Pattern
```javascript
// useVideo.js
export function useVideo(videoElement) {
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  
  useEffect(() => {
    if (!videoElement) return;
    
    const handleTimeUpdate = () => {
      setCurrentTime(videoElement.currentTime);
    };
    
    videoElement.addEventListener('timeupdate', handleTimeUpdate);
    return () => {
      videoElement.removeEventListener('timeupdate', handleTimeUpdate);
    };
  }, [videoElement]);
  
  const play = () => {
    videoElement?.play();
    setPlaying(true);
  };
  
  const pause = () => {
    videoElement?.pause();
    setPlaying(false);
  };
  
  return { playing, currentTime, play, pause };
}
```

---

## Testing Approach

### Unit Testing
```javascript
// Test pure functions
import { describe, it, expect } from 'vitest';
import { lerp, timeToPixel } from './utils';

describe('Interpolation', () => {
  it('lerps between two values', () => {
    expect(lerp(0, 100, 0.5)).toBe(50);
    expect(lerp(0, 100, 0)).toBe(0);
    expect(lerp(0, 100, 1)).toBe(100);
  });
});
```

### Component Testing
```javascript
// Test component behavior
import { render, screen, fireEvent } from '@testing-library/react';
import { VideoPlayer } from './VideoPlayer';

test('play button toggles playback', () => {
  render(<VideoPlayer src="test.mp4" />);
  
  const playButton = screen.getByRole('button', { name: /play/i });
  fireEvent.click(playButton);
  
  expect(playButton).toHaveTextContent('Pause');
});
```

### Integration Testing
```javascript
// Test feature workflows
test('crop keyframe workflow', async () => {
  const { user } = render(<App />);
  
  // Load video
  await user.upload(screen.getByLabelText('Upload'), file);
  
  // Create keyframe
  await user.click(screen.getByText('Add Keyframe'));
  
  // Verify keyframe created
  expect(screen.getByText('Keyframe at 0:00')).toBeInTheDocument();
});
```

---

## Common Patterns

### Loading State Pattern
```javascript
const [state, setState] = useState('idle'); // 'idle' | 'loading' | 'success' | 'error'

if (state === 'loading') return <Spinner />;
if (state === 'error') return <Error />;
if (state === 'success') return <Content />;
return <EmptyState />;
```

### Debouncing Pattern
```javascript
const debouncedSave = useMemo(
  () => debounce((data) => save(data), 500),
  []
);

useEffect(() => {
  debouncedSave(data);
}, [data]);
```

### Canvas Rendering Pattern
```javascript
useEffect(() => {
  const canvas = canvasRef.current;
  const ctx = canvas.getContext('2d');
  
  function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // Draw content
    requestAnimationFrame(render);
  }
  
  const id = requestAnimationFrame(render);
  return () => cancelAnimationFrame(id);
}, [dependencies]);
```

---

## Debugging Strategy

### Console Logging
```javascript
// Add strategic logging
console.log('[VideoPlayer] Playing:', playing);
console.log('[Timeline] Current time:', currentTime);
console.log('[Crop] Keyframes:', keyframes);

// Remove before production
```

### React DevTools
- Inspect component props and state
- Use Profiler to find slow renders
- Check component tree structure

### Browser DevTools
- Network tab for file loading
- Performance tab for rendering issues
- Memory tab for leak detection
- Console for errors and warnings

### Breakpoint Debugging
```javascript
// Use debugger statement
function handleClick() {
  debugger; // Execution pauses here
  doSomething();
}
```

---

## Performance Optimization

### Identify Bottlenecks
1. Use React Profiler to find slow components
2. Use Chrome DevTools Performance tab
3. Check render count (React DevTools)

### Common Fixes
```javascript
// Memoize expensive calculations
const expensiveValue = useMemo(() => {
  return computeExpensiveValue(data);
}, [data]);

// Prevent re-renders
const MemoizedComponent = React.memo(Component);

// Callback stability
const handleClick = useCallback(() => {
  doSomething();
}, [dependencies]);
```

---

## Error Prevention

### TypeScript Benefits
```typescript
// Catch errors at compile time
interface Crop {
  x: number;
  y: number;
  width: number;
  height: number;
}

// TypeScript ensures all properties present
const crop: Crop = {
  x: 0,
  y: 0,
  width: 100,
  height: 100
};
```

### Runtime Validation
```javascript
// Validate at boundaries
function setCrop(crop) {
  if (!crop || typeof crop.x !== 'number') {
    throw new Error('Invalid crop object');
  }
  // Use crop
}
```

---

## Getting Unstuck

### Problem: Feature is too complex
**Solution**: Break it into smaller pieces
- Implement simplest version first
- Add complexity incrementally
- Test each piece independently

### Problem: Bug is hard to find
**Solution**: Systematic debugging
1. Reproduce reliably
2. Add logging at each step
3. Binary search (comment out half the code)
4. Isolate to minimal example

### Problem: Performance is poor
**Solution**: Profile and optimize
1. Use React Profiler
2. Use Chrome Performance tab
3. Identify bottleneck
4. Apply targeted optimization

### Problem: Not sure how to implement
**Solution**: Ask specific questions
- "How do I implement [specific thing]?"
- "What's the best way to [action]?"
- "Can you show an example of [pattern]?"

---

## Success Checklist

For each phase, ensure:
- [ ] All features from spec implemented
- [ ] Tests passing
- [ ] No console errors
- [ ] Performance acceptable
- [ ] Code reviewed and refactored
- [ ] Ready for next phase

---

## Communication with AI

### Good Prompts
✅ "Implement the crop overlay component from Phase 2"
✅ "Help me debug this error: [specific error]"
✅ "Optimize this function for better performance"
✅ "Add TypeScript types to this code"

### Less Effective Prompts
❌ "Make the video editor"
❌ "Fix the bugs"
❌ "Make it better"
❌ "Add all the features"

### Best Practice
- Be specific about what you need
- Provide context and relevant code
- Ask one thing at a time
- Iterate on the response

---

## Final Tips

1. **Read the spec thoroughly** before starting each phase
2. **Test frequently** - don't wait until everything is done
3. **Commit often** - save your progress
4. **Ask for help** when stuck - AI is there to help
5. **Take breaks** - complex features need time to understand
6. **Document as you go** - future you will thank you

Good luck building your video editor! 🎬
