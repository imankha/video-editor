import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useVideo } from './useVideo';
import { useVideoStore } from '../stores';

/**
 * T15750 (AC2): "Edit play" calls pause() synchronously, but the RAF
 * desync-recovery loop (useVideo's playback-time effect) schedules its next
 * frame via requestAnimationFrame BEFORE that pause() runs. React's effect
 * cleanup (cancelAnimationFrame) only cancels the frame that would be
 * scheduled on re-render -- a frame already in flight still fires once, with
 * its OWN stale closure over the pre-pause isPlaying=true. Reading `paused`
 * on the (pre-fix) video element inside that stale callback looked like a
 * desync ("store says playing, element says paused") and called play() right
 * back on, resuming playback moments after the deliberate pause.
 */
function fakeVideo() {
  return {
    src: 'blob:fake', duration: 100, currentTime: 10, paused: false, readyState: 4, playbackRate: 1,
    networkState: 1,
    buffered: { length: 1, start: () => 0, end: () => 60 },
    pause: vi.fn(), play: vi.fn(() => Promise.resolve()), load: vi.fn(),
  };
}

describe('useVideo: a stale RAF desync-recovery frame must not resume playback after a deliberate pause (T15750:C2)', () => {
  let rafCallback;
  let rafSpy;

  beforeEach(() => {
    useVideoStore.setState({ isPlaying: false, isBuffering: false, isSeeking: false, isWaitingForData: false, duration: 100, clipOffset: 0, clipDuration: null });
    rafCallback = null;
    rafSpy = vi.spyOn(global, 'requestAnimationFrame').mockImplementation((cb) => {
      if (!rafCallback) rafCallback = cb;
      return 1;
    });
    // Desync cooldown (lastDesyncResumeRef) starts at 0; make performance.now()
    // comfortably clear the 3000ms gate so the (pre-fix) resume branch is
    // actually reached, not accidentally skipped by the cooldown.
    vi.spyOn(performance, 'now').mockReturnValue(10_000);
  });

  afterEach(() => {
    rafSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it('does not call play() on a frame scheduled before pause() fires', () => {
    const { result } = renderHook(() => useVideo(null, null));
    const fake = fakeVideo();
    act(() => { result.current.videoRef.current = fake; });
    // Starts the RAF loop (mirrors a real Play press).
    act(() => { useVideoStore.setState({ isPlaying: true }); });
    expect(rafCallback).toBeTruthy();

    // Edit play's handleAddClipFromButton calls effectivePause() synchronously
    // -- the video element itself is now paused, same as this fake reflects.
    act(() => { fake.paused = true; result.current.pause(); });
    expect(fake.pause).toHaveBeenCalled();

    // The frame requestAnimationFrame already scheduled before pause() still
    // fires once (React cancels only the NEXT one, via effect cleanup).
    act(() => { rafCallback(); });

    expect(fake.play).not.toHaveBeenCalled();
    expect(useVideoStore.getState().isPlaying).toBe(false);
  });
});
