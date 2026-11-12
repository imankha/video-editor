import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useVideo } from './useVideo';
import { useVideoStore } from '../stores';

// T15720: Safari refuses a cross-origin fetch whose credentials flag is true
// unless the response carries Access-Control-Allow-Credentials: true. The
// post-error diagnostic probe in handleError (fetch(video.src, {Range,
// credentials:'include'})) sent credentials unconditionally, so on a
// cross-origin video.src (API_BASE != frontend origin, or an R2 presigned
// URL) Safari's preflight is refused -- exactly the console errors from the
// staging QA pass. Credentials must only be sent for a same-origin URL.
function fakeVideo({ src, code }) {
  return {
    src,
    error: { code },
    duration: 0, currentTime: 0, paused: true, readyState: 0, playbackRate: 1,
    networkState: 3,
    buffered: { length: 0, start: () => 0, end: () => 0 },
    pause: vi.fn(), play: vi.fn(() => Promise.resolve()), load: vi.fn(),
  };
}

describe('useVideo cross-origin error-probe credentials (T15720)', () => {
  beforeEach(() => {
    useVideoStore.setState({ isPlaying: false, isBuffering: false, isWaitingForData: false, duration: 100, clipOffset: 0, clipDuration: null });
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ status: 404, headers: new Map(), body: { cancel: vi.fn() } })));
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('does not send credentials when probing a cross-origin src on a SRC_NOT_SUPPORTED error', async () => {
    const { result } = renderHook(() => useVideo(null, null));
    act(() => {
      result.current.videoRef.current = fakeVideo({
        src: 'https://totally-different-origin.example.com/api/games/5/video',
        code: 4,
      });
    });
    await act(async () => { await result.current.handlers.onError(); });

    expect(fetch).toHaveBeenCalled();
    const [, opts] = fetch.mock.calls[0];
    expect(opts.credentials).not.toBe('include');
  });

  it('still sends credentials when probing a same-origin src', async () => {
    const { result } = renderHook(() => useVideo(null, null));
    act(() => {
      result.current.videoRef.current = fakeVideo({
        src: `${window.location.origin}/api/games/5/video`,
        code: 4,
      });
    });
    await act(async () => { await result.current.handlers.onError(); });

    expect(fetch).toHaveBeenCalled();
    const [, opts] = fetch.mock.calls[0];
    expect(opts.credentials).toBe('include');
  });
});
