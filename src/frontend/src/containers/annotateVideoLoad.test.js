import { describe, it, expect, vi } from 'vitest';
import {
  buildEarlyGameVideoSrc,
  beginGameVideoLoad,
  computeResumePosition,
  seekVideoElementWhenReady,
} from './annotateVideoLoad';
import { API_BASE } from '../config';

describe('buildEarlyGameVideoSrc', () => {
  it('builds a stable, gameId-only /video URL with no suffix when there is no clip seek', () => {
    expect(buildEarlyGameVideoSrc('game-42')).toBe(`${API_BASE}/api/games/game-42/video`);
    expect(buildEarlyGameVideoSrc('game-42', null)).toBe(`${API_BASE}/api/games/game-42/video`);
  });

  it('appends the click-time clip seek as a #t= fragment', () => {
    expect(buildEarlyGameVideoSrc('game-42', 12.5)).toBe(`${API_BASE}/api/games/game-42/video#t=12.5`);
    // 0 is a real seek target, not "absent"
    expect(buildEarlyGameVideoSrc('game-42', 0)).toBe(`${API_BASE}/api/games/game-42/video#t=0`);
  });
});

describe('beginGameVideoLoad', () => {
  it('sets the video src from the stable /video URL BEFORE loadGame resolves', () => {
    const setAnnotateVideoUrl = vi.fn();
    let resolveLoad;
    const loadGame = vi.fn(() => new Promise((resolve) => { resolveLoad = resolve; }));

    const promise = beginGameVideoLoad({
      gameId: 'game-7',
      pendingClipSeekTime: null,
      setAnnotateVideoUrl,
      loadGame,
    });

    // The src must already be set synchronously, while loadGame is still pending.
    expect(setAnnotateVideoUrl).toHaveBeenCalledTimes(1);
    expect(setAnnotateVideoUrl).toHaveBeenCalledWith(`${API_BASE}/api/games/game-7/video`);
    expect(loadGame).toHaveBeenCalledWith('game-7');

    // The promise is loadGame's in-flight promise (resolves later, in parallel).
    resolveLoad({ game: { id: 'game-7' } });
    return expect(promise).resolves.toEqual({ game: { id: 'game-7' } });
  });

  it('carries a click-time clip seek into the early src', () => {
    const setAnnotateVideoUrl = vi.fn();
    const loadGame = vi.fn(() => Promise.resolve({ game: {} }));
    beginGameVideoLoad({ gameId: 'g1', pendingClipSeekTime: 9, setAnnotateVideoUrl, loadGame });
    expect(setAnnotateVideoUrl).toHaveBeenCalledWith(`${API_BASE}/api/games/g1/video#t=9`);
  });
});

describe('computeResumePosition', () => {
  it('prefers last_playhead_position when within the video duration', () => {
    expect(computeResumePosition({ video_duration: 100, last_playhead_position: 42 })).toBe(42);
  });

  it('ignores last_playhead_position at/after the end and falls back to viewed_duration', () => {
    expect(computeResumePosition({ video_duration: 100, last_playhead_position: 100, viewed_duration: 30 })).toBe(30);
  });

  it('skips viewed_duration resume once past 95% (treat as finished)', () => {
    expect(computeResumePosition({ video_duration: 100, viewed_duration: 96 })).toBeNull();
  });

  it('returns null when there is nothing to resume', () => {
    expect(computeResumePosition({ video_duration: 100 })).toBeNull();
    expect(computeResumePosition({ video_duration: 0, last_playhead_position: 5 })).toBeNull();
    expect(computeResumePosition(null)).toBeNull();
  });
});

describe('seekVideoElementWhenReady', () => {
  it('seeks immediately when metadata is already available', () => {
    const video = { readyState: 1, currentTime: 0, addEventListener: vi.fn() };
    seekVideoElementWhenReady(video, 25);
    expect(video.currentTime).toBe(25);
    expect(video.addEventListener).not.toHaveBeenCalled();
  });

  it('defers the seek to loadedmetadata when metadata is not ready', () => {
    const listeners = {};
    const video = {
      readyState: 0,
      currentTime: 0,
      addEventListener: vi.fn((ev, cb) => { listeners[ev] = cb; }),
      removeEventListener: vi.fn(),
    };
    seekVideoElementWhenReady(video, 25);
    expect(video.currentTime).toBe(0); // not yet
    expect(video.addEventListener).toHaveBeenCalledWith('loadedmetadata', expect.any(Function));

    listeners.loadedmetadata(); // metadata arrives
    expect(video.currentTime).toBe(25);
    expect(video.removeEventListener).toHaveBeenCalledWith('loadedmetadata', listeners.loadedmetadata);
  });

  it('is a no-op for a missing element or null position', () => {
    expect(() => seekVideoElementWhenReady(null, 10)).not.toThrow();
    const video = { readyState: 1, currentTime: 0, addEventListener: vi.fn() };
    seekVideoElementWhenReady(video, null);
    expect(video.currentTime).toBe(0);
  });
});
