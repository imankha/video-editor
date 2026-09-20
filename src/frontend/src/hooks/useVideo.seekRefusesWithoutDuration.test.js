import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useVideo } from './useVideo';
import { useVideoStore } from '../stores';

/**
 * T10750: `seek` used to compute
 *   `const effectiveDuration = duration || (clipDuration ?? video.duration) || 0`
 * and then clamp with `Math.min(time, effectiveDuration)`. With no duration known
 * yet, that trailing `|| 0` silently turned EVERY seek into a seek-to-0.
 *
 * That is the banned silent-fallback-on-internal-data pattern (CLAUDE.md), and it
 * had a real consequence: a clip selected on Annotate entry was immediately wiped
 * by the playhead-driven auto-deselect, because the playhead had been parked at 0
 * instead of inside the clip. Observed live as
 * `[DetectionSeek] SEEK requested=181.290090s clamped=0.000000s`.
 *
 * It must now REFUSE (warn + no-op) instead of clamping.
 */

// currentTime starts at a NON-ZERO value on purpose: the bug wrote 0 here, so
// asserting "still 42" is a real assertion where "still 0" would be vacuous.
function makeFakeVideo({ duration = NaN, currentTime = 42 } = {}) {
  return {
    src: 'blob:fake',
    duration,
    currentTime,
    paused: true,
    readyState: 0,
    pause: vi.fn(),
    play: vi.fn(() => Promise.resolve()),
  };
}

function setStore({ duration = 0, clipDuration = null } = {}) {
  useVideoStore.setState({
    currentTime: 0,
    isPlaying: false,
    isSeeking: false,
    isBuffering: false,
    duration,
    clipOffset: 0,
    clipDuration,
  });
}

describe('useVideo.seek — refuses instead of clamping to 0 (T10750)', () => {
  let warnSpy;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does NOT move the playhead to 0 when no duration is known', () => {
    setStore({ duration: 0, clipDuration: null });
    const video = makeFakeVideo({ duration: NaN });
    // Annotate uses useVideo(null, null) -- no clampToVisibleRange -- which is
    // exactly the path this guard covers. Focus passes its own clamp fn and is
    // deliberately unaffected.
    const { result } = renderHook(() => useVideo(null, null));
    act(() => { result.current.videoRef.current = video; });

    act(() => { result.current.seek(181.29); });

    // The whole bug: this used to become 0.
    expect(video.currentTime).toBe(42); // untouched, NOT clamped to 0
    expect(useVideoStore.getState().currentTime).toBe(0); // no bogus 0 written as a real position
    expect(useVideoStore.getState().isSeeking).toBe(false); // no seek was started
    expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/Refusing seek to 181\.290s/));
  });

  it('seeks normally once a real duration is known (negative control)', () => {
    setStore({ duration: 300, clipDuration: null });
    const video = makeFakeVideo({ duration: 300 });
    const { result } = renderHook(() => useVideo(null, null));
    act(() => { result.current.videoRef.current = video; });

    act(() => { result.current.seek(181.29); });

    expect(video.currentTime).toBeCloseTo(181.29, 3);
    expect(useVideoStore.getState().isSeeking).toBe(true);
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringMatching(/Refusing seek/));
  });

  it('does NOT refuse when the caller supplies its own clampToVisibleRange (Focus scoping)', () => {
    // Focus calls useVideo(getSegmentAtTime, clampToVisibleRange) and its clamp
    // fn owns the range entirely — `effectiveDuration` never participates there,
    // so the refusal must not apply. Pins the axis the guard is scoped on.
    setStore({ duration: 0, clipDuration: null });
    const video = makeFakeVideo({ duration: NaN });
    const { result } = renderHook(() => useVideo(null, (t) => t));
    act(() => { result.current.videoRef.current = video; });

    act(() => { result.current.seek(12.5); });

    expect(video.currentTime).toBeCloseTo(12.5, 3);
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringMatching(/Refusing seek/));
  });

  it('still clamps past the end when a duration IS known', () => {
    setStore({ duration: 100, clipDuration: null });
    const video = makeFakeVideo({ duration: 100 });
    const { result } = renderHook(() => useVideo(null, null));
    act(() => { result.current.videoRef.current = video; });

    act(() => { result.current.seek(99999); });

    expect(video.currentTime).toBeCloseTo(100, 3);
  });
});
