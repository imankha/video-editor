import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useVideoProxy } from './useVideoProxy';

// T8970 regression: exiting Playback Annotations remounts the annotate <video>
// elements as fresh, blank DOM nodes. The seed effect that sets .src imperatively
// is keyed on the timeline/URL, so it does NOT re-run on that remount -> the new
// node stayed blank (the "video was blank after playback" bug). The multiVideo
// slots now use callback refs (attachA/attachB) that reapply the active slot's
// src on remount. Single-video is unaffected (VideoPlayer sets src via a JSX
// attribute, which survives remount) and has no callback ref.

const VIDEOS = [
  { sequence: 1, url: 'https://r2.example.com/video0.mp4', duration: 300, width: 1920, height: 1080 },
  { sequence: 2, url: 'https://r2.example.com/video1.mp4', duration: 300, width: 1920, height: 1080 },
];

describe('useVideoProxy — callback ref reapplies src on remount (T8970)', () => {
  let loadSpy;
  beforeEach(() => {
    // jsdom does not implement HTMLMediaElement.load(); stub it so .load() calls
    // in attachSlot don't throw.
    loadSpy = vi.spyOn(window.HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  });
  afterEach(() => {
    loadSpy.mockRestore();
  });

  it('exposes attachA/attachB callback refs only in multiVideo mode', () => {
    const multi = renderHook(() => useVideoProxy({ videos: VIDEOS }));
    expect(typeof multi.result.current.videoController._renderRefs.attachA).toBe('function');
    expect(typeof multi.result.current.videoController._renderRefs.attachB).toBe('function');

    const single = renderHook(() => useVideoProxy({ videos: [VIDEOS[0]] }));
    expect(single.result.current.videoController._renderRefs.attachA).toBeUndefined();
    expect(single.result.current.videoController._renderRefs.videoARef).toBeDefined();
  });

  it('reapplies src to a BLANK active-slot node that remounts after the seed effect', () => {
    const { result } = renderHook(() => useVideoProxy({ videos: VIDEOS }));
    const { attachA } = result.current.videoController._renderRefs;

    // A fresh <video> DOM node (the post-playback remount): blank to start.
    const remounted = document.createElement('video');
    expect(remounted.src).toBe('');

    act(() => { attachA(remounted); });

    // Pre-fix this stayed blank; now the active slot's src is reapplied.
    expect(remounted.src).toBe('https://r2.example.com/video0.mp4');
    expect(loadSpy).toHaveBeenCalled();
  });

  it('does NOT force src onto the inactive slot (it reseeds on the next seek)', () => {
    const { result } = renderHook(() => useVideoProxy({ videos: VIDEOS }));
    const { attachB } = result.current.videoController._renderRefs;

    // Active slot is 'A' after the seed effect, so a remounted B must stay blank.
    const remountedB = document.createElement('video');
    act(() => { attachB(remountedB); });

    expect(remountedB.src).toBe('');
  });

  it('leaves an already-sourced (reused) node alone', () => {
    const { result } = renderHook(() => useVideoProxy({ videos: VIDEOS }));
    const { attachA } = result.current.videoController._renderRefs;

    const reused = document.createElement('video');
    reused.src = 'https://r2.example.com/already.mp4';
    loadSpy.mockClear();
    act(() => { attachA(reused); });

    // Unchanged, and no extra load() forced — the seed effect owns any reset.
    expect(reused.src).toBe('https://r2.example.com/already.mp4');
    expect(loadSpy).not.toHaveBeenCalled();
  });
});
