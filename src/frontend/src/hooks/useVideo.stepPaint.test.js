import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useVideo } from './useVideo';
import { useVideoStore } from '../stores';

/**
 * Bug 38 (glitch 3): frame-by-frame stepping while PAUSED must actually present
 * the stepped frame. On Safari/streaming sources the seeked frame can fail to
 * paint (and the buffering spinner covers it) because the RAF loop only
 * repaints while playing and 'seeked' can lag. seek() now registers a one-shot
 * requestVideoFrameCallback while paused; when the frame is presented it clears
 * the seek/buffering state so the stepped frame shows.
 */
function makeFakeVideo({ paused = true } = {}) {
  const rvfcQueue = [];
  return {
    src: 'blob:fake',
    duration: 10,
    currentTime: 0,
    paused,
    requestVideoFrameCallback: vi.fn((cb) => {
      rvfcQueue.push(cb);
      return rvfcQueue.length; // handle id
    }),
    cancelVideoFrameCallback: vi.fn(),
    // test helper: fire the most recent rVFC callback (frame presented)
    _presentFrame() {
      const cb = rvfcQueue.shift();
      if (cb) cb(performance.now(), {});
    },
    _rvfcCount() { return rvfcQueue.length; },
  };
}

describe('useVideo paused frame-step repaint (bug 38 glitch 3)', () => {
  beforeEach(() => {
    // Reset shared store so isSeeking/isBuffering start clean.
    useVideoStore.setState({ currentTime: 0, isSeeking: false, isBuffering: false, duration: null });
  });

  it('stepForward advances exactly one frame and registers a paused repaint callback', () => {
    const { result } = renderHook(() => useVideo());
    const fake = makeFakeVideo({ paused: true });
    act(() => { result.current.videoRef.current = fake; });

    act(() => { result.current.stepForward(); });

    // Advanced exactly one frame at 30fps (1/30s).
    expect(fake.currentTime).toBeCloseTo(1 / 30, 6);
    // Registered a one-shot rVFC to confirm the paused frame paints.
    expect(fake.requestVideoFrameCallback).toHaveBeenCalledTimes(1);
    // Seeking is active until the frame is presented.
    expect(useVideoStore.getState().isSeeking).toBe(true);
  });

  it('clears seeking/buffering state when the paused frame is presented', () => {
    const { result } = renderHook(() => useVideo());
    const fake = makeFakeVideo({ paused: true });
    act(() => { result.current.videoRef.current = fake; });

    act(() => { result.current.stepForward(); });
    expect(useVideoStore.getState().isSeeking).toBe(true);

    // Simulate the browser presenting the seeked frame while paused.
    act(() => { fake._presentFrame(); });

    expect(useVideoStore.getState().isSeeking).toBe(false);
    expect(useVideoStore.getState().isBuffering).toBe(false);
  });

  it('stepBackward at frame 0 stays at 0 (clamped) and still registers repaint', () => {
    const { result } = renderHook(() => useVideo());
    const fake = makeFakeVideo({ paused: true });
    act(() => { result.current.videoRef.current = fake; });

    act(() => { result.current.stepBackward(); });

    expect(fake.currentTime).toBe(0);
    expect(fake.requestVideoFrameCallback).toHaveBeenCalledTimes(1);
  });

  it('does NOT register a paused repaint callback while playing', () => {
    const { result } = renderHook(() => useVideo());
    const fake = makeFakeVideo({ paused: false });
    act(() => { result.current.videoRef.current = fake; });

    act(() => { result.current.stepForward(); });

    expect(fake.requestVideoFrameCallback).not.toHaveBeenCalled();
  });

  it('is a graceful no-op where requestVideoFrameCallback is unsupported', () => {
    const { result } = renderHook(() => useVideo());
    const fake = makeFakeVideo({ paused: true });
    delete fake.requestVideoFrameCallback;
    delete fake.cancelVideoFrameCallback;
    act(() => { result.current.videoRef.current = fake; });

    expect(() => {
      act(() => { result.current.stepForward(); });
    }).not.toThrow();
    expect(fake.currentTime).toBeCloseTo(1 / 30, 6);
  });
});
