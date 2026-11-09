import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useVideo } from './useVideo';
import { useVideoStore } from '../stores';

/**
 * T15340 fix round 1: a resume-point seek fires as soon as the STORE's
 * `duration`/`clipOffset` are set (loadVideoFromStreamingUrl sets them before
 * the real <video> element has loaded), so `seek()` can run while the element
 * is still at readyState HAVE_NOTHING. handleLoadedMetadata used to
 * unconditionally reset `video.currentTime = clipOffset` once the native
 * `loadedmetadata` event finally arrived, silently clobbering that seek back
 * to the clip start. It must leave an already-requested seek alone.
 */

function makeFakeVideo({ duration = 8, currentTime = 0, readyState = 0 } = {}) {
  return {
    src: 'blob:fake',
    duration,
    currentTime,
    paused: true,
    readyState,
    videoWidth: 1280,
    videoHeight: 720,
    pause: vi.fn(),
    play: vi.fn(() => Promise.resolve()),
  };
}

describe('useVideo resume seek survives a later loadedmetadata (T15340 fix round 1)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not reset to clipOffset when a seek was already requested before loadedmetadata fires', () => {
    const clipOffset = 27.165584;
    const clipDuration = 8;
    useVideoStore.setState({
      currentTime: 0,
      isPlaying: false,
      isSeeking: false,
      isBuffering: false,
      duration: clipDuration,
      clipOffset,
      clipDuration,
      metadata: { width: 1280, height: 720, duration: clipDuration },
    });

    const { result } = renderHook(() => useVideo(null, (t) => Math.max(0, Math.min(t, clipDuration))));
    const fake = makeFakeVideo({ duration: clipOffset + clipDuration, readyState: 0, currentTime: 0 });
    act(() => { result.current.videoRef.current = fake; });

    // Resume-seek effect fires while the element is still at readyState 0
    // (duration/clipOffset already live in the store, the element itself
    // hasn't loaded yet) -- seeking past the clip end, expecting a clamp to
    // the clip end (clipOffset + clipDuration).
    act(() => { result.current.seek(9999); });
    expect(fake.currentTime).toBeCloseTo(clipOffset + clipDuration, 3);

    // The native `loadedmetadata` event arrives after our seek.
    fake.readyState = 4;
    act(() => { result.current.handlers.onLoadedMetadata(); });

    // Must still be at the clip end, not reset to clipOffset (clip start).
    expect(fake.currentTime).toBeCloseTo(clipOffset + clipDuration, 3);
  });

  it('still seeks the element to clipOffset on loadedmetadata when no seek was requested', () => {
    const clipOffset = 27.165584;
    const clipDuration = 8;
    useVideoStore.setState({
      currentTime: 0,
      isPlaying: false,
      isSeeking: false,
      isBuffering: false,
      duration: clipDuration,
      clipOffset,
      clipDuration,
      metadata: { width: 1280, height: 720, duration: clipDuration },
    });

    const { result } = renderHook(() => useVideo(null, (t) => Math.max(0, Math.min(t, clipDuration))));
    const fake = makeFakeVideo({ duration: clipOffset + clipDuration, readyState: 4, currentTime: 0 });
    act(() => { result.current.videoRef.current = fake; });

    act(() => { result.current.handlers.onLoadedMetadata(); });

    expect(fake.currentTime).toBeCloseTo(clipOffset, 3);
  });
});
