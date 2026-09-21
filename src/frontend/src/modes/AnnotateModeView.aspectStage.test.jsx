import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * T10800: the non-fullscreen Annotate single-video stage is aspect-fit (mirrors
 * Overlay's T5676 useAspectStage) so the 16:9 picture no longer sits inside a
 * fixed h-[40vh]/60vh box with black letterbox bands above and below on a phone.
 *
 * The aspect comes from ONE resolved value: the <video> element's metadata, else
 * the game row's video_width/video_height (so the box is shaped BEFORE the
 * picture loads), else an EXPLICIT, warned "dimensions unknown" branch that keeps
 * today's fixed box (no `|| 16 / || 9` coercion). Fullscreen owns its own sizing
 * and is untouched.
 */

// Expose fitToAspect + fullscreen so we can assert what the stage passes down.
vi.mock('../components/VideoPlayer', () => ({
  VideoPlayer: (props) => (
    <div
      data-testid="video-player"
      data-fit-to-aspect={String(props.fitToAspect)}
      data-is-fullscreen={String(props.isFullscreen)}
    />
  ),
}));
vi.mock('../components/shared/VideoLoadingOverlay', () => ({
  VideoLoadingOverlay: () => <div />,
}));
vi.mock('../components/ZoomControls', () => ({ default: () => <div /> }));
vi.mock('./annotate', () => ({
  AnnotateMode: () => <div />,
  AnnotateControls: () => <div />,
  NotesOverlay: () => <div />,
  AnnotateFullscreenOverlay: () => <div />,
}));
vi.mock('./annotate/components/PlaybackControls', () => ({ default: () => <div /> }));
vi.mock('../components/shared', () => ({
  Button: ({ children }) => <button>{children}</button>,
}));
vi.mock('../hooks/useIsMobile', () => ({
  useIsMobile: () => false,
  useIsLandscape: () => false,
}));
vi.mock('../hooks/useFullscreenControls', () => ({
  useFullscreenControls: () => ({
    isVisible: true,
    handleInteraction: () => {},
    handleTapVideo: () => {},
    handleLongPressTouchStart: () => {},
    handleLongPressTouchMove: () => {},
    handleLongPressTouchEnd: () => {},
  }),
}));

import { AnnotateModeView } from './AnnotateModeView';

function renderView(overrides = {}) {
  const props = {
    videoController: { _renderRefs: { videoARef: { current: null }, videoBRef: { current: null } } },
    annotateVideoUrl: '/api/games/1/video',
    annotateVideoMetadata: { width: 1920, height: 1080, duration: 100, format: 'mp4', size: 0 },
    annotateContainerRef: { current: null },
    currentTime: 0,
    duration: 100,
    isPlaying: false,
    handlers: {},
    annotateFullscreen: false,
    showAnnotateOverlay: false,
    togglePlay: vi.fn(),
    stepForward: vi.fn(),
    stepBackward: vi.fn(),
    seekBackward: vi.fn(),
    restart: vi.fn(),
    seek: vi.fn(),
    onTimelineSeek: vi.fn(),
    annotatePlaybackSpeed: 1,
    onSpeedChange: vi.fn(),
    annotateRegionsWithLayout: [],
    annotateSelectedRegionId: null,
    hasAnnotateClips: false,
    clipRegions: [],
    isEditMode: false,
    onSelectRegion: vi.fn(),
    onDeleteRegion: vi.fn(),
    getAnnotateRegionAtTime: () => null,
    annotateSelectedLayer: 'clips',
    onLayerSelect: vi.fn(),
    playback: { isPlaybackMode: false },
    multiVideo: null,
    boundaryOffsets: undefined,
    isSourceExpired: false,
    gameId: 7,
    ...overrides,
  };
  return render(<AnnotateModeView {...props} />);
}

// The stage box is the direct parent of the (mocked) VideoPlayer.
const stageBox = () => screen.getByTestId('video-player').parentElement;

describe('T10800 AnnotateModeView aspect-fit single-video stage', () => {
  let warnSpy;
  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('(a) shapes the box from element metadata and passes fitToAspect', () => {
    renderView({ annotateVideoMetadata: { width: 1920, height: 1080 } });
    const box = stageBox();
    expect(box.style.aspectRatio).toBe('1920 / 1080');
    expect(box.className).toContain('max-h-[60vh]');
    expect(box.className).toContain('lg:h-[60vh]');
    expect(screen.getByTestId('video-player').getAttribute('data-fit-to-aspect')).toBe('true');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('(b) falls back to the game row dims before metadata arrives (no layout jump)', () => {
    renderView({ annotateVideoMetadata: null, gameVideoWidth: 1280, gameVideoHeight: 720 });
    const box = stageBox();
    expect(box.style.aspectRatio).toBe('1280 / 720');
    expect(screen.getByTestId('video-player').getAttribute('data-fit-to-aspect')).toBe('true');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('(c) with neither, keeps today\'s fixed box and warns naming the game id', () => {
    renderView({ annotateVideoMetadata: null, gameVideoWidth: undefined, gameVideoHeight: undefined, gameId: 42 });
    const box = stageBox();
    expect(box.style.aspectRatio).toBe('');
    expect(box.className).toContain('h-[40vh]');
    expect(box.className).toContain('sm:h-[60vh]');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('42');
  });

  it('(d) fullscreen owns its own sizing (no aspect box, no fitToAspect)', () => {
    renderView({ annotateFullscreen: true, annotateVideoMetadata: { width: 1920, height: 1080 } });
    const box = stageBox();
    expect(box.className).toContain('absolute inset-0');
    expect(box.className).not.toContain('lg:h-[60vh]');
    expect(box.style.aspectRatio).toBe('');
    expect(screen.getByTestId('video-player').getAttribute('data-fit-to-aspect')).toBe('false');
  });
});
