import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useVideo } from './useVideo';
import { useVideoStore } from '../stores';

// T14350: a fast double-click/double-tap on the video toggles play then pause
// within a few ms. The `play` event from the first toggle is dispatched AFTER
// the second toggle's pause(), so handlePlay used to set isPlaying=true on a
// paused element; the RAF desync loop then called play() and the video ended
// up playing (seen live as play, pause, play from one double-click). A stale
// `play` event must not mark a paused element as playing, and (the mirror case,
// double-tap while playing) a stale `pause` event must not mark a playing
// element as paused.
function fakeVideo(paused) {
  return {
    src: 'blob:fake', duration: 100, currentTime: 10, paused, readyState: 4, playbackRate: 1,
    networkState: 1,
    buffered: { length: 1, start: () => 0, end: () => 60 },
    pause: vi.fn(), play: vi.fn(() => Promise.resolve()), load: vi.fn(),
  };
}

describe('useVideo ignores stale play / pause events (T14350)', () => {
  beforeEach(() => {
    useVideoStore.setState({ isPlaying: false, isBuffering: false, isWaitingForData: false, duration: 100, clipOffset: 0, clipDuration: null });
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('a play event arriving after pause() leaves isPlaying false', () => {
    const { result } = renderHook(() => useVideo(null, null));
    act(() => { result.current.videoRef.current = fakeVideo(true); });
    act(() => { result.current.handlers.onPlay(); });
    expect(useVideoStore.getState().isPlaying).toBe(false);
  });

  it('a play event on a playing element still sets isPlaying', () => {
    const { result } = renderHook(() => useVideo(null, null));
    act(() => { result.current.videoRef.current = fakeVideo(false); });
    act(() => { result.current.handlers.onPlay(); });
    expect(useVideoStore.getState().isPlaying).toBe(true);
  });

  it('a pause event arriving after play() leaves isPlaying true', () => {
    useVideoStore.setState({ isPlaying: true });
    const { result } = renderHook(() => useVideo(null, null));
    act(() => { result.current.videoRef.current = fakeVideo(false); });
    act(() => { result.current.handlers.onPause(); });
    expect(useVideoStore.getState().isPlaying).toBe(true);
  });

  it('a pause event on a paused element still clears isPlaying', () => {
    useVideoStore.setState({ isPlaying: true });
    const { result } = renderHook(() => useVideo(null, null));
    act(() => { result.current.videoRef.current = fakeVideo(true); });
    act(() => { result.current.handlers.onPause(); });
    expect(useVideoStore.getState().isPlaying).toBe(false);
  });
});
