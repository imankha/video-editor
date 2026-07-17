import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRef } from 'react';
import useVideoDisplayRect, {
  computeVideoDisplayRect,
  videoToScreenRect,
  screenToVideoRect,
  round3,
} from '../useVideoDisplayRect';

// T4550: the video->screen transform (aspect-fit letterbox + zoom/pan, plus its
// inverse) was duplicated across three overlays. These tests pin the unified math.

const approx = (a, b, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe('computeVideoDisplayRect — aspect-fit letterbox', () => {
  it('letterboxes a wide video in a square container (top/bottom bars)', () => {
    // video 800x400 (aspect 2) inside 400x400 (aspect 1): constrained by width.
    const r = computeVideoDisplayRect({
      containerWidth: 400,
      containerHeight: 400,
      videoWidth: 800,
      videoHeight: 400,
    });
    approx(r.width, 400);
    approx(r.height, 200);
    approx(r.offsetX, 0); // spans full width
    approx(r.offsetY, 100); // (400 - 200) / 2 — bar top & bottom
    approx(r.scaleX, 0.5);
    approx(r.scaleY, 0.5);
  });

  it('pillarboxes a tall video in a square container (left/right bars)', () => {
    // video 400x800 (aspect 0.5) inside 400x400: constrained by height.
    const r = computeVideoDisplayRect({
      containerWidth: 400,
      containerHeight: 400,
      videoWidth: 400,
      videoHeight: 800,
    });
    approx(r.width, 200);
    approx(r.height, 400);
    approx(r.offsetX, 100); // (400 - 200) / 2 — bar left & right
    approx(r.offsetY, 0);
    approx(r.scaleX, 0.5);
    approx(r.scaleY, 0.5);
  });

  it('keeps a matching-aspect video edge-to-edge (no bars, scaleX == scaleY)', () => {
    const r = computeVideoDisplayRect({
      containerWidth: 640,
      containerHeight: 360,
      videoWidth: 1280,
      videoHeight: 720,
    });
    approx(r.offsetX, 0);
    approx(r.offsetY, 0);
    approx(r.width, 640);
    approx(r.height, 360);
    approx(r.scaleX, r.scaleY);
    approx(r.scaleX, 0.5);
  });
});

describe('computeVideoDisplayRect — zoom and pan', () => {
  it('scales the displayed video by zoom and re-centers it', () => {
    const base = computeVideoDisplayRect({
      containerWidth: 640,
      containerHeight: 360,
      videoWidth: 1280,
      videoHeight: 720,
    });
    const zoomed = computeVideoDisplayRect({
      containerWidth: 640,
      containerHeight: 360,
      videoWidth: 1280,
      videoHeight: 720,
      zoom: 2,
    });
    approx(zoomed.width, base.width * 2);
    approx(zoomed.height, base.height * 2);
    approx(zoomed.scaleX, base.scaleX * 2);
    // 2x zoom overflows the container symmetrically: offset goes negative by half the growth.
    approx(zoomed.offsetX, (640 - 1280) / 2); // -320
    approx(zoomed.offsetY, (360 - 720) / 2); // -180
  });

  it('shifts offsets by panOffset (and only offsets, not scale)', () => {
    const panned = computeVideoDisplayRect({
      containerWidth: 640,
      containerHeight: 360,
      videoWidth: 1280,
      videoHeight: 720,
      zoom: 2,
      panOffset: { x: 30, y: -15 },
    });
    approx(panned.offsetX, (640 - 1280) / 2 + 30); // -290
    approx(panned.offsetY, (360 - 720) / 2 - 15); // -195
    approx(panned.scaleX, 1); // 1280/1280 at 2x -> 1
  });

  it('recenters correctly when the container grows (fullscreen)', () => {
    // Same video, windowed vs fullscreen container: still centered, bars recomputed.
    const windowed = computeVideoDisplayRect({
      containerWidth: 800,
      containerHeight: 450,
      videoWidth: 1920,
      videoHeight: 1080,
    });
    const fullscreen = computeVideoDisplayRect({
      containerWidth: 1920,
      containerHeight: 1080,
      videoWidth: 1920,
      videoHeight: 1080,
    });
    // 16:9 video in 16:9 container -> edge to edge at both sizes.
    approx(windowed.offsetX, 0);
    approx(fullscreen.offsetX, 0);
    approx(fullscreen.width, 1920);
    approx(fullscreen.scaleX, 1);
  });

  it('letterboxes a 16:9 video inside a 16:10 fullscreen container', () => {
    // 1920x1080 video in a 1920x1200 screen: bars top & bottom.
    const r = computeVideoDisplayRect({
      containerWidth: 1920,
      containerHeight: 1200,
      videoWidth: 1920,
      videoHeight: 1080,
    });
    approx(r.width, 1920);
    approx(r.height, 1080);
    approx(r.offsetX, 0);
    approx(r.offsetY, (1200 - 1080) / 2); // 60
  });
});

describe('videoToScreenRect / screenToVideoRect', () => {
  const rect = computeVideoDisplayRect({
    containerWidth: 400,
    containerHeight: 400,
    videoWidth: 800,
    videoHeight: 400,
  }); // scale 0.5, offsetY 100

  it('maps the video origin to the top-left of the displayed video', () => {
    const s = videoToScreenRect(rect, 0, 0, 100, 100);
    approx(s.x, 0);
    approx(s.y, 100);
    approx(s.width, 50);
    approx(s.height, 50);
  });

  it('maps an arbitrary box into screen space', () => {
    const s = videoToScreenRect(rect, 200, 100, 400, 200);
    approx(s.x, 100); // 200 * 0.5 + 0
    approx(s.y, 150); // 100 * 0.5 + 100
    approx(s.width, 200);
    approx(s.height, 100);
  });

  it('is an exact inverse: screenToVideo(videoToScreen(p)) === p', () => {
    const zoomedRect = computeVideoDisplayRect({
      containerWidth: 640,
      containerHeight: 360,
      videoWidth: 1280,
      videoHeight: 720,
      zoom: 1.75,
      panOffset: { x: 42, y: -19 },
    });
    const box = { x: 321, y: 158, w: 640, h: 360 };
    const screen = videoToScreenRect(zoomedRect, box.x, box.y, box.w, box.h);
    const back = screenToVideoRect(zoomedRect, screen.x, screen.y, screen.width, screen.height);
    approx(back.x, box.x);
    approx(back.y, box.y);
    approx(back.width, box.w);
    approx(back.height, box.h);
  });

  it('returns zeros for a null rect (pre-measurement guard)', () => {
    expect(videoToScreenRect(null, 1, 2, 3, 4)).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    expect(screenToVideoRect(null, 1, 2, 3, 4)).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  it('round3 rounds to 3 decimals', () => {
    expect(round3(1.23456)).toBe(1.235);
    expect(round3(2)).toBe(2);
  });
});

describe('useVideoDisplayRect (hook)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Mount a real container + video so videoRef.current.closest('.video-container')
  // resolves, and stub getBoundingClientRect (jsdom returns zeros otherwise).
  function mountWithContainer({ zoom = 1, panOffset = { x: 0, y: 0 } } = {}) {
    const container = document.createElement('div');
    container.className = 'video-container';
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
      width: 400,
      height: 400,
      left: 0,
      top: 0,
      right: 400,
      bottom: 400,
      x: 0,
      y: 0,
      toJSON: () => {},
    });
    const video = document.createElement('video');
    container.appendChild(video);
    document.body.appendChild(container);

    // Stable references — the effect deps include videoMetadata/panOffset, so a fresh
    // object each render would re-trigger forever (mirrors how the app passes stable props).
    const videoMetadata = { width: 800, height: 400 };
    const wrapper = renderHook(() => {
      const ref = useRef(video);
      return useVideoDisplayRect(ref, videoMetadata, { zoom, panOffset });
    });
    return { ...wrapper, cleanupDom: () => document.body.removeChild(container) };
  }

  it('computes the rect on first paint (useLayoutEffect, no null flash)', () => {
    const { result, cleanupDom } = mountWithContainer();
    // Synchronously available after mount — layout effect ran before we read it.
    expect(result.current.rect).not.toBeNull();
    approx(result.current.rect.scaleX, 0.5);
    approx(result.current.rect.offsetY, 100);
    cleanupDom();
  });

  it('exposes videoToScreen/screenToVideo bound to the measured rect', () => {
    const { result, cleanupDom } = mountWithContainer();
    const s = result.current.videoToScreen(0, 0, 100, 100);
    approx(s.y, 100);
    const back = result.current.screenToVideo(s.x, s.y, s.width, s.height);
    approx(back.x, 0);
    approx(back.y, 0);
    cleanupDom();
  });

  it('does not leak a requestAnimationFrame callback past unmount', () => {
    const cancelSpy = vi.spyOn(window, 'cancelAnimationFrame');
    const { unmount, cleanupDom } = mountWithContainer();
    act(() => unmount());
    // Both the outer and inner rAF ids must be cancelled (>= 2 cancels).
    expect(cancelSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    cleanupDom();
  });
});
