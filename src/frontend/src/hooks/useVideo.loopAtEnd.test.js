import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useVideo } from './useVideo';
import { useVideoStore } from '../stores';

/**
 * 2026-09-18 (user request): "when your playhead gets to the end of the clip
 * it should loop around" -- the RAF playback loop used to pause() and freeze
 * on the last frame once currentTime reached clipDuration. It now seeks back
 * to clip start and keeps playing (never pauses), so isPlaying stays true and
 * the browser just continues from 0.
 */

function makeFakeVideo({ currentTime = 0 } = {}) {
  return {
    src: 'blob:fake',
    duration: 10,
    currentTime,
    paused: false, // actively playing
    readyState: 4, // HAVE_ENOUGH_DATA -- past the HAVE_CURRENT_DATA gate
    pause: vi.fn(),
    play: vi.fn(() => Promise.resolve()),
  };
}

describe('useVideo playback loop at clip end', () => {
  let rafCallback;
  let rafSpy;

  beforeEach(() => {
    useVideoStore.setState({
      currentTime: 0,
      isPlaying: false,
      isSeeking: false,
      isBuffering: false,
      duration: 10,
      clipOffset: 0,
      clipDuration: 10,
    });
    rafCallback = null;
    // The RAF playback loop re-schedules itself every frame; capture only the
    // FIRST callback so the test drives exactly one iteration.
    rafSpy = vi.spyOn(global, 'requestAnimationFrame').mockImplementation((cb) => {
      if (!rafCallback) rafCallback = cb;
      return 1;
    });
  });

  afterEach(() => {
    rafSpy.mockRestore();
  });

  it('seeks back to 0 and keeps playing once the playhead reaches clipDuration (no pause)', () => {
    const { result } = renderHook(() => useVideo());
    const fake = makeFakeVideo({ currentTime: 10.05 }); // past the 10s clipDuration
    act(() => { result.current.videoRef.current = fake; });

    // The mount-time effect ran before videoRef was populated (`!videoRef.current`
    // bails early) -- flip isPlaying to force the effect to re-run now that the
    // ref is set, matching how a real Play press starts it.
    act(() => { useVideoStore.setState({ isPlaying: true }); });

    expect(rafCallback).toBeTruthy();
    act(() => { rafCallback(); });

    expect(fake.pause).not.toHaveBeenCalled();
    expect(fake.currentTime).toBe(0); // clipToVideo(0) == 0 at clipOffset 0
    expect(useVideoStore.getState().currentTime).toBe(0);
    expect(useVideoStore.getState().isPlaying).toBe(true); // never paused
  });

  it('does not loop before the playhead reaches clipDuration', () => {
    const { result } = renderHook(() => useVideo());
    const fake = makeFakeVideo({ currentTime: 5 }); // well before the 10s clipDuration
    act(() => { result.current.videoRef.current = fake; });
    act(() => { useVideoStore.setState({ isPlaying: true }); });

    act(() => { rafCallback(); });

    expect(fake.pause).not.toHaveBeenCalled();
    expect(fake.currentTime).toBe(5); // untouched
    expect(useVideoStore.getState().currentTime).toBe(5);
  });
});
