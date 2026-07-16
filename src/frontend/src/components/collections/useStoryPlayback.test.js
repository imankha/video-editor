import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useStoryPlayback } from './useStoryPlayback';

// A minimal stand-in for the <video> element. duration/currentTime are plain
// properties the test controls directly (jsdom's HTMLMediaElement is inert), so
// we can simulate "duration not known yet" -> "loadedmetadata" transitions.
function makeVideo(duration = 0) {
  return {
    duration,
    currentTime: 0,
    paused: true,
    play: vi.fn(() => Promise.resolve()),
    pause: vi.fn(),
    load: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
}

let rafCb = null;
let realRaf;
let realCancel;

beforeEach(() => {
  rafCb = null;
  realRaf = global.requestAnimationFrame;
  realCancel = global.cancelAnimationFrame;
  // Record the scheduled callback instead of running it; the test drives frames.
  global.requestAnimationFrame = vi.fn((cb) => { rafCb = cb; return 1; });
  global.cancelAnimationFrame = vi.fn();
});

afterEach(() => {
  global.requestAnimationFrame = realRaf;
  global.cancelAnimationFrame = realCancel;
});

// Run one rAF tick (the tick re-schedules itself, so rafCb is refreshed after).
function frame() {
  const cb = rafCb;
  act(() => { cb?.(); });
}

const REELS = [
  { id: 1, name: 'A', streamUrl: 'a', aspect_ratio: '9:16', duration: null },
  { id: 2, name: 'B', streamUrl: 'b', aspect_ratio: '9:16', duration: null },
];

describe('useStoryPlayback goTo seek (T5100)', () => {
  it('seeks immediately (next frame) when clicking the already-active reel', () => {
    const video = makeVideo(100);
    const ref = { current: video };
    const { result } = renderHook(() => useStoryPlayback(ref, REELS, { initialIndex: 0 }));

    act(() => { result.current.goTo(0, 0.6); });
    frame();

    expect(video.currentTime).toBe(60); // 0.6 * live duration
    expect(result.current.activeIndex).toBe(0);
    expect(video.play).toHaveBeenCalled(); // playback resumes after the seek
  });

  it('seeks using the ELEMENT duration even when the reel frozen duration is null', () => {
    const video = makeVideo(50); // reel.duration is null; element reports 50
    const ref = { current: video };
    const { result } = renderHook(() => useStoryPlayback(ref, REELS, { initialIndex: 0 }));

    act(() => { result.current.goTo(1, 0.4); });
    frame();

    expect(result.current.activeIndex).toBe(1);
    expect(video.currentTime).toBe(20); // 0.4 * 50, not from the null frozen duration
  });

  it('defers the seek until the new reel reports a duration', () => {
    const video = makeVideo(0); // duration not known yet (post v.load())
    const ref = { current: video };
    const { result } = renderHook(() => useStoryPlayback(ref, REELS, { initialIndex: 0 }));

    act(() => { result.current.goTo(1, 0.5); });
    frame();
    expect(video.currentTime).toBe(0); // nothing to seek against yet

    video.duration = 80; // loadedmetadata fires
    frame();
    expect(video.currentTime).toBe(40); // 0.5 * 80, applied once duration is known
  });

  it('cancels a stashed seek if the reel advances before its duration is known', () => {
    const video = makeVideo(0); // target reel still loading
    const ref = { current: video };
    const { result } = renderHook(() => useStoryPlayback(ref, REELS, { initialIndex: 0 }));

    act(() => { result.current.goTo(1, 0.5); }); // stash a seek for reel 1
    frame(); // duration unknown -> pending stays
    act(() => { result.current.next(); }); // user steps away before it applied

    video.duration = 80; // metadata finally arrives
    frame();
    expect(video.currentTime).toBe(0); // stale fraction did NOT leak onto the new reel
  });

  it('ignores out-of-range indices', () => {
    const video = makeVideo(100);
    const ref = { current: video };
    const { result } = renderHook(() => useStoryPlayback(ref, REELS, { initialIndex: 0 }));

    act(() => { result.current.goTo(5, 0.5); });
    frame();
    expect(result.current.activeIndex).toBe(0);
    expect(video.currentTime).toBe(0);
  });
});
