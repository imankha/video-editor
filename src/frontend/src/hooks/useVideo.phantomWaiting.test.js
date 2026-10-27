import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useVideo } from './useVideo';
import { useVideoStore } from '../stores';

// T13700:C4 (bug 54): a `waiting` event with ample buffer ahead is a "phantom" stall. It must not
// set isBuffering (that blocks time updates, see handleWaiting) but the user pressed Play and sees
// a frozen clock for ~25 s, so a display-only isWaitingForData flag must drive the spinner.
function fakeVideo() {
  return {
    src: 'blob:fake', duration: 100, currentTime: 10, paused: false, readyState: 1, playbackRate: 1,
    networkState: 2,
    buffered: { length: 1, start: () => 0, end: () => 60 },
    pause: vi.fn(), play: vi.fn(() => Promise.resolve()), load: vi.fn(),
  };
}

describe('useVideo phantom waiting shows a spinner (T13700:C4)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    useVideoStore.setState({ isPlaying: true, isBuffering: false, isWaitingForData: false, duration: 100, clipOffset: 0, clipDuration: null });
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('flags waiting without blocking time updates, and clears on playing', () => {
    const { result } = renderHook(() => useVideo(null, null));
    act(() => { result.current.videoRef.current = fakeVideo(); });
    act(() => { result.current.handlers.onWaiting(); });
    expect(useVideoStore.getState().isBuffering).toBe(false);
    expect(useVideoStore.getState().isWaitingForData).toBe(true);
    act(() => { result.current.handlers.onPlaying(); });
    expect(useVideoStore.getState().isWaitingForData).toBe(false);
  });
});
