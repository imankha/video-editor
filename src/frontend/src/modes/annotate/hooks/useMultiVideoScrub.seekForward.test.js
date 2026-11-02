import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMultiVideoScrub } from './useMultiVideoScrub';

// T14350: the Forward 5 s button, Right arrow, L and the double-tap all call
// AnnotateContainer's effectiveSeekForward, which is multiVideo.seekForward for
// a multi-video game. A skip from near the end of video 1 must land in video 2
// at the right offset (virtual timeline), not clamp at video 1's end.
// Characterization: seekForward predates T14350; this pins the boundary case the
// new skips rely on.

const VIDEOS = [
  { sequence: 1, url: 'https://r2.example.com/video0.mp4', duration: 300, width: 1920, height: 1080 },
  { sequence: 2, url: 'https://r2.example.com/video1.mp4', duration: 300, width: 1920, height: 1080 },
];

describe('useMultiVideoScrub seekForward across a source boundary (T14350)', () => {
  let loadSpy;
  beforeEach(() => {
    loadSpy = vi.spyOn(window.HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  });
  afterEach(() => loadSpy.mockRestore());

  it('a 5 s skip from 298 s lands in video 2 at 3 s', () => {
    const { result } = renderHook(() => useMultiVideoScrub({ gameVideos: VIDEOS }));
    const { attachA, attachB } = result.current.videoController._renderRefs;
    const a = document.createElement('video');
    const b = document.createElement('video');
    act(() => { attachA(a); attachB(b); });

    act(() => { result.current.seek(298); });
    expect(a.currentTime).toBeCloseTo(298);

    act(() => { result.current.seekForward(5); });
    // The inactive slot is loaded with video 2 and positioned 3 s in.
    expect(b.src).toBe('https://r2.example.com/video1.mp4');
    expect(b.currentTime).toBeCloseTo(3);
  });

  it('a 5 s skip back from 302 s (video 2 at 2 s) lands in video 1 at 297 s', () => {
    const { result } = renderHook(() => useMultiVideoScrub({ gameVideos: VIDEOS }));
    const { attachA, attachB } = result.current.videoController._renderRefs;
    const a = document.createElement('video');
    const b = document.createElement('video');
    act(() => { attachA(a); attachB(b); });

    act(() => { result.current.seek(302); });
    act(() => { b.dispatchEvent(new Event('seeked')); });
    act(() => { result.current.seekBackward(5); });
    // After the swap B is active (video 2); A is reloaded with video 1 at 297 s.
    expect(a.src).toBe('https://r2.example.com/video0.mp4');
    expect(a.currentTime).toBeCloseTo(297);
  });
});
