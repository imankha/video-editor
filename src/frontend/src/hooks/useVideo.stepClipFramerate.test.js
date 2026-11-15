import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useVideo } from './useVideo';
import { useVideoStore } from '../stores';

/**
 * T4540: frame stepping moves one frame of the LOADED clip's frame rate, not a
 * hard-coded 30. Frame loads a clip with metadata.framerate = the clip's stored
 * fps (working_clips.fps); a 60 fps clip must step 1/60 s per press, and a clip
 * whose rate is unknown must refuse to step (loudly) instead of guessing.
 */
function makeFakeVideo() {
  return {
    src: 'blob:fake',
    duration: 10,
    currentTime: 0,
    paused: true,
    requestVideoFrameCallback: vi.fn(() => 1),
    cancelVideoFrameCallback: vi.fn(),
  };
}

describe('T4540 frame stepping uses the clip frame rate', () => {
  let errorSpy;
  beforeEach(() => {
    useVideoStore.setState({ currentTime: 0, isSeeking: false, isBuffering: false, duration: null, metadata: null });
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => errorSpy.mockRestore());

  it('a 60 fps clip steps forward one 60 fps frame per press', () => {
    useVideoStore.setState({ metadata: { framerate: 60, width: 1920, height: 1080, duration: 10 } });
    const { result } = renderHook(() => useVideo());
    const fake = makeFakeVideo();
    act(() => { result.current.videoRef.current = fake; });

    act(() => { result.current.stepForward(); });
    expect(fake.currentTime).toBeCloseTo(1 / 60, 6);
    act(() => { result.current.stepForward(); });
    expect(fake.currentTime).toBeCloseTo(2 / 60, 6);
  });

  it('a 60 fps clip steps backward one 60 fps frame per press', () => {
    useVideoStore.setState({ currentTime: 2 / 60, metadata: { framerate: 60, width: 1920, height: 1080, duration: 10 } });
    const { result } = renderHook(() => useVideo());
    const fake = makeFakeVideo();
    act(() => { result.current.videoRef.current = fake; });

    act(() => { result.current.stepBackward(); });
    expect(fake.currentTime).toBeCloseTo(1 / 60, 6);
  });

  it('a clip with no known frame rate refuses to step and says why', () => {
    useVideoStore.setState({ metadata: { framerate: null, width: 1920, height: 1080, duration: 10 } });
    const { result } = renderHook(() => useVideo());
    const fake = makeFakeVideo();
    act(() => { result.current.videoRef.current = fake; });

    act(() => { result.current.stepForward(); });
    expect(fake.currentTime).toBe(0);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('frame rate'));
  });
});
