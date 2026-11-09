import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFullscreenControls, ControlState } from './useFullscreenControls';

// T15380 (AC4): landscape mobile fullscreen, PAUSED -- after a control tap the
// controls must auto-hide within the 3s delay same as while playing. Before
// this fix, handleInteraction only armed the timer `if (isPlaying)`, so a
// paused tap left the controls visible forever (exactly the state the user is
// in while trimming/scrubbing).
describe('useFullscreenControls — auto-hide arms while paused (T15380)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('handleInteraction while paused still hides controls after 3s', () => {
    const { result } = renderHook(() => useFullscreenControls({ isPlaying: false }));
    expect(result.current.controlState).toBe(ControlState.VISIBLE);

    act(() => { result.current.handleInteraction(); });
    expect(result.current.controlState).toBe(ControlState.VISIBLE);

    act(() => { vi.advanceTimersByTime(3000); });
    expect(result.current.controlState).toBe(ControlState.HIDDEN);
  });

  it('handleInteraction while playing still hides controls after 3s (regression)', () => {
    const { result } = renderHook(() => useFullscreenControls({ isPlaying: true }));
    act(() => { result.current.handleInteraction(); });
    act(() => { vi.advanceTimersByTime(3000); });
    expect(result.current.controlState).toBe(ControlState.HIDDEN);
  });
});
