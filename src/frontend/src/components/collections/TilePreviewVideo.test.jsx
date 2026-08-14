import { render, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TilePreviewVideo } from './TilePreviewVideo';
import { PREVIEW_PHASE } from '../../hooks/useTilePreview';

// jsdom does not implement HTMLMediaElement playback — stub the methods the
// primitive drives so we can assert WHAT it does (attach/play/release), and leave
// requestVideoFrameCallback undefined so the `playing`-event crossfade fallback runs.
let playSpy;
let loadSpy;
let pauseSpy;
beforeEach(() => {
  playSpy = vi.fn().mockResolvedValue(undefined);
  loadSpy = vi.fn();
  pauseSpy = vi.fn();
  HTMLMediaElement.prototype.play = playSpy;
  HTMLMediaElement.prototype.load = loadSpy;
  HTMLMediaElement.prototype.pause = pauseSpy;
});
afterEach(() => vi.restoreAllMocks());

const STREAM = '/api/downloads/9/stream';

describe('TilePreviewVideo — poster-first crossfade (T6420)', () => {
  it('IDLE: preload="none", no src, faded out (grid at rest fires zero requests)', () => {
    const { container } = render(<TilePreviewVideo streamUrl={STREAM} phase={PREVIEW_PHASE.IDLE} />);
    const video = container.querySelector('video');
    expect(video.getAttribute('preload')).toBe('none');
    expect(video.getAttribute('src')).toBeNull();
    expect(video.className).toMatch(/opacity-0/);
    expect(video.className).toMatch(/pointer-events-none/);
  });

  it('WARM: attaches src + buffers (load), still paused, poster still showing', () => {
    const { container } = render(<TilePreviewVideo streamUrl={STREAM} phase={PREVIEW_PHASE.WARM} />);
    const video = container.querySelector('video');
    expect(video.getAttribute('src')).toBe(STREAM);
    expect(loadSpy).toHaveBeenCalled();
    expect(playSpy).not.toHaveBeenCalled();
    expect(video.className).toMatch(/opacity-0/); // no frame yet -> poster still on top
  });

  it('REVEAL: plays, and crossfades in on the first rendered frame (playing event)', () => {
    const onFirstFrame = vi.fn();
    const { container } = render(
      <TilePreviewVideo streamUrl={STREAM} phase={PREVIEW_PHASE.REVEAL} onFirstFrame={onFirstFrame} />
    );
    const video = container.querySelector('video');
    expect(playSpy).toHaveBeenCalled();
    // Before a frame lands, the video is invisible (poster-first, never a black box).
    expect(video.className).toMatch(/opacity-0/);
    fireEvent.playing(video);
    expect(video.className).toMatch(/opacity-100/);
  });

  it('teardown (REVEAL -> IDLE): pauses, clears src + load (releases the stream), fades out', () => {
    const { container, rerender } = render(
      <TilePreviewVideo streamUrl={STREAM} phase={PREVIEW_PHASE.REVEAL} />
    );
    const video = container.querySelector('video');
    fireEvent.playing(video);
    expect(video.className).toMatch(/opacity-100/);

    loadSpy.mockClear();
    rerender(<TilePreviewVideo streamUrl={STREAM} phase={PREVIEW_PHASE.IDLE} />);
    expect(pauseSpy).toHaveBeenCalled();
    expect(video.getAttribute('src')).toBeNull(); // stream released
    expect(loadSpy).toHaveBeenCalled();
    expect(video.className).toMatch(/opacity-0/);
  });

  it('warm is idempotent: re-rendering WARM does not re-attach or reload the same src', () => {
    const { container, rerender } = render(
      <TilePreviewVideo streamUrl={STREAM} phase={PREVIEW_PHASE.WARM} />
    );
    const video = container.querySelector('video');
    expect(loadSpy).toHaveBeenCalledTimes(1);
    loadSpy.mockClear();
    rerender(<TilePreviewVideo streamUrl={STREAM} phase={PREVIEW_PHASE.WARM} />);
    expect(loadSpy).not.toHaveBeenCalled();
    expect(video.getAttribute('src')).toBe(STREAM);
  });
});

// T6820 — the source-clip proxy serves the WHOLE game video, so a windowed preview
// must seek into [start,end] and loop there. Final/working previews (no window) keep
// native loop-from-0. jsdom backs a real currentTime property, so we can assert seeks.
describe('TilePreviewVideo — source-clip window (T6820)', () => {
  it('no window props: native loop stays on and nothing seeks (final/working path unchanged)', () => {
    const { container } = render(<TilePreviewVideo streamUrl={STREAM} phase={PREVIEW_PHASE.WARM} />);
    const video = container.querySelector('video');
    expect(video.hasAttribute('loop')).toBe(true);
    fireEvent.loadedMetadata(video);
    expect(video.currentTime).toBe(0);
  });

  it('with startTime: seeks into the clip window on loadedmetadata, native loop disabled', () => {
    const { container } = render(
      <TilePreviewVideo streamUrl={STREAM} phase={PREVIEW_PHASE.WARM} startTime={12.5} endTime={20} />
    );
    const video = container.querySelector('video');
    expect(video.hasAttribute('loop')).toBe(false); // manual loop instead
    fireEvent.loadedMetadata(video);
    expect(video.currentTime).toBe(12.5);
  });

  it('loops back to startTime once playback passes endTime, but not while inside the window', () => {
    const { container } = render(
      <TilePreviewVideo streamUrl={STREAM} phase={PREVIEW_PHASE.REVEAL} startTime={12} endTime={20} />
    );
    const video = container.querySelector('video');
    fireEvent.loadedMetadata(video);
    expect(video.currentTime).toBe(12);
    // Inside the window -> left alone.
    video.currentTime = 15;
    fireEvent.timeUpdate(video);
    expect(video.currentTime).toBe(15);
    // At/past the end -> wrap to start.
    video.currentTime = 20;
    fireEvent.timeUpdate(video);
    expect(video.currentTime).toBe(12);
  });
});
