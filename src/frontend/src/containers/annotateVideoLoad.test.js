import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  buildEarlyGameVideoSrc,
  beginGameVideoLoad,
  computeResumePosition,
  seekVideoElementWhenReady,
  __resetBeginLoadDedup,
} from './annotateVideoLoad';
import { API_BASE } from '../config';

// beginGameVideoLoad dedups by gameId across calls; clear it so each test starts clean.
afterEach(() => __resetBeginLoadDedup());

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

describe('beginGameVideoLoad dedup (StrictMode / remount)', () => {
  it('sets the src and fires /load only ONCE for a double-invoke of the same game', () => {
    const setAnnotateVideoUrl = vi.fn();
    const loadGame = vi.fn(() => new Promise(() => {})); // stays in-flight

    const p1 = beginGameVideoLoad({ gameId: 42, pendingClipSeekTime: null, setAnnotateVideoUrl, loadGame });
    const p2 = beginGameVideoLoad({ gameId: 42, pendingClipSeekTime: null, setAnnotateVideoUrl, loadGame });

    // Exactly one src-set (one <video> fetch) and one /load, despite two invocations.
    expect(setAnnotateVideoUrl).toHaveBeenCalledTimes(1);
    expect(loadGame).toHaveBeenCalledTimes(1);
    // The second call returns the same in-flight promise.
    expect(p2).toBe(p1);
  });

  it('does not dedup across different games', () => {
    const setAnnotateVideoUrl = vi.fn();
    const loadGame = vi.fn(() => new Promise(() => {}));

    beginGameVideoLoad({ gameId: 1, pendingClipSeekTime: null, setAnnotateVideoUrl, loadGame });
    beginGameVideoLoad({ gameId: 2, pendingClipSeekTime: null, setAnnotateVideoUrl, loadGame });

    expect(loadGame).toHaveBeenCalledTimes(2);
    expect(setAnnotateVideoUrl).toHaveBeenCalledTimes(2);
  });

  it('allows a genuine re-open after /load settles (in-flight entry cleared)', async () => {
    const setAnnotateVideoUrl = vi.fn();
    const loadGame = vi.fn(() => Promise.resolve({ game: { id: 7 } }));

    await beginGameVideoLoad({ gameId: 7, pendingClipSeekTime: null, setAnnotateVideoUrl, loadGame });
    // Let the .finally() cleanup run.
    await Promise.resolve();
    await beginGameVideoLoad({ gameId: 7, pendingClipSeekTime: null, setAnnotateVideoUrl, loadGame });

    expect(loadGame).toHaveBeenCalledTimes(2);
    expect(setAnnotateVideoUrl).toHaveBeenCalledTimes(2);
  });
});

// T6280 QA — the "games/{id}/video 302 x2" HAR finding.
//
// Opening a saved game seeds the /video src TWICE by design, from two places:
//   1. useAnnotateState's useState initializer (peekPendingGame) — the first-paint
//      pre-seed, so the <video> mounts WITH a src (T4000).
//   2. handleLoadGame -> beginGameVideoLoad, when it consumes the same breadcrumb.
// The second assignment is a deliberate NO-OP: it must build the IDENTICAL URL, so
// React sees the same src string and does not re-assign the <video> (no second 302).
// applyGameData then never re-sets the single-video src. The net production request
// count is therefore ONE — the HAR's x2 was React StrictMode's dev-only effect
// double-invoke (a prod build makes <StrictMode> a no-op passthrough). This test pins
// the URL-equality invariant that keeps the no-op a no-op.
describe('early /video src is a single production request (T6280)', () => {
  it('pre-seed URL equals the beginGameVideoLoad URL, so the second src-set is a no-op', () => {
    const gameId = 6;
    const seekTime = 12.5;

    // (1) The pre-seed built in useAnnotateState's useState initializer.
    const preSeedUrl = buildEarlyGameVideoSrc(gameId, seekTime);

    // (2) The URL beginGameVideoLoad assigns when handleLoadGame consumes the
    //     same breadcrumb (gameId + seekTime). Capture what it hands setAnnotateVideoUrl.
    const setAnnotateVideoUrl = vi.fn();
    const loadGame = vi.fn(() => new Promise(() => {}));
    beginGameVideoLoad({ gameId, pendingClipSeekTime: seekTime, setAnnotateVideoUrl, loadGame });

    expect(setAnnotateVideoUrl).toHaveBeenCalledTimes(1);
    const beginLoadUrl = setAnnotateVideoUrl.mock.calls[0][0];

    // Identical string -> setAnnotateVideoUrl(sameSrc) cannot trigger a second <video>
    // load. If these ever diverge, the fragment/URL change would refetch the media.
    expect(beginLoadUrl).toBe(preSeedUrl);
  });

  it('holds for a first-paint open with no clip seek (both resolve to the bare /video URL)', () => {
    const gameId = 6;
    const preSeedUrl = buildEarlyGameVideoSrc(gameId, null);

    const setAnnotateVideoUrl = vi.fn();
    const loadGame = vi.fn(() => new Promise(() => {}));
    beginGameVideoLoad({ gameId, pendingClipSeekTime: null, setAnnotateVideoUrl, loadGame });

    expect(setAnnotateVideoUrl.mock.calls[0][0]).toBe(preSeedUrl);
    expect(preSeedUrl).toBe(`${API_BASE}/api/games/${gameId}/video`);
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
