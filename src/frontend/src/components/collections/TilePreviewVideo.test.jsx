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
