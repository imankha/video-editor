import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useVideo } from './useVideo';
import { useVideoStore } from '../stores';

/**
 * T17280 (bug 62p): a game already uploaded as iPhone HEVC opens in a browser
 * that cannot decode it. The element loads audio only (videoWidth 0, real
 * duration, no media error), so the player played sound over a blank stage
 * with no message. loadedmetadata with a 0x0 picture must surface an error.
 */
function makeFakeVideo({ videoWidth, videoHeight }) {
  return {
    src: 'https://r2.example/games/abc.mp4', duration: 3600, currentTime: 0,
    paused: true, readyState: 1, videoWidth, videoHeight,
    pause: vi.fn(), play: vi.fn(() => Promise.resolve()),
  };
}

function openWith(fake) {
  useVideoStore.getState().reset();
  const { result } = renderHook(() => useVideo(null, (t) => t));
  act(() => { result.current.videoRef.current = fake; });
  act(() => { result.current.handlers.onLoadedMetadata(); });
  return result;
}

describe('T17280 useVideo: sound with no picture is an error, not silent', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('sets a video error naming the picture problem when the loaded picture is 0x0', () => {
    openWith(makeFakeVideo({ videoWidth: 0, videoHeight: 0 }));
    const error = useVideoStore.getState().error;
    expect(error).toBeTruthy();
    expect(error).toMatch(/picture/i);
  });

  it('keeps the error when loadeddata follows (it clears errors for a playable picture only)', () => {
    const result = openWith(makeFakeVideo({ videoWidth: 0, videoHeight: 0 }));
    act(() => { result.current.handlers.onLoadedData(); });
    expect(useVideoStore.getState().error).toMatch(/picture/i);
  });

  it('leaves no error for a video with a picture', () => {
    openWith(makeFakeVideo({ videoWidth: 1920, videoHeight: 1080 }));
    expect(useVideoStore.getState().error).toBeNull();
  });
});
