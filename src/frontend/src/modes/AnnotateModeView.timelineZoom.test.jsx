import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * T10930: AnnotateModeView OWNS the timeline zoom (useTimelineZoom) and hands it
 * to every AnnotateMode mount site, so: a phone opens at 300%, desktop at 100%,
 * +/- move it in 25% steps, and a fullscreen toggle (which remounts the
 * timeline at a different site) keeps whatever the user set.
 */

const mobile = { value: false };

vi.mock('../components/VideoPlayer', () => ({ VideoPlayer: () => <div data-testid="video-player" /> }));
vi.mock('../components/shared/VideoLoadingOverlay', () => ({ VideoLoadingOverlay: () => <div /> }));
vi.mock('../components/ZoomControls', () => ({ default: () => <div /> }));
vi.mock('./annotate', () => ({
  // Surface the zoom prop the real AnnotateTimeline would turn into the chip.
  AnnotateMode: ({ zoom }) => (
    <div data-testid="timeline" data-zoom={zoom?.timelineZoom}>
      <button data-testid="zin" onClick={zoom?.zoomIn}>+</button>
      <button data-testid="zout" onClick={zoom?.zoomOut}>-</button>
      <button data-testid="zreset" onClick={zoom?.resetZoom}>reset</button>
    </div>
  ),
  AnnotateControls: () => <div data-testid="controls" />,
  NotesOverlay: () => <div />,
  AnnotateFullscreenOverlay: () => <div data-testid="overlay" />,
}));
vi.mock('./annotate/components/PlaybackControls', () => ({ default: () => <div data-testid="playback-controls" /> }));
vi.mock('../components/shared', () => ({ Button: ({ children }) => <button>{children}</button> }));
vi.mock('../hooks/useIsMobile', () => ({ useIsMobile: () => mobile.value, useIsLandscape: () => false }));
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

function baseProps(overrides = {}) {
  return {
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
    hasAnnotateClips: true,
    clipRegions: [],
    isEditMode: false,
    onSelectRegion: vi.fn(),
    onDeleteRegion: vi.fn(),
    onAddClip: vi.fn(),
    getAnnotateRegionAtTime: () => null,
    annotateSelectedLayer: 'clips',
    onLayerSelect: vi.fn(),
    playback: { isPlaybackMode: false, enterPlaybackMode: vi.fn() },
    multiVideo: null,
    boundaryOffsets: undefined,
    isSourceExpired: false,
    onShare: vi.fn(),
    hasUnsentShares: false,
    ...overrides,
  };
}

const zoomOf = () => screen.getByTestId('timeline').getAttribute('data-zoom');

describe('AnnotateModeView timeline zoom ownership (T10930)', () => {
  beforeEach(() => { mobile.value = false; });

  it('desktop opens at 100% and steps by 25%; reset returns to 100%', () => {
    render(<AnnotateModeView {...baseProps()} />);
    expect(zoomOf()).toBe('100');
    fireEvent.click(screen.getByTestId('zin'));
    fireEvent.click(screen.getByTestId('zin'));
    expect(zoomOf()).toBe('150');
    fireEvent.click(screen.getByTestId('zout'));
    expect(zoomOf()).toBe('125');
    fireEvent.click(screen.getByTestId('zreset'));
    expect(zoomOf()).toBe('100');
  });

  it('phone opens at 300% and can zoom OUT to 100%', () => {
    mobile.value = true;
    render(<AnnotateModeView {...baseProps()} />);
    expect(zoomOf()).toBe('300');
    for (let i = 0; i < 8; i++) fireEvent.click(screen.getByTestId('zout'));
    expect(zoomOf()).toBe('100');
    fireEvent.click(screen.getByTestId('zout'));
    expect(zoomOf()).toBe('100'); // floor
  });

  it('a fullscreen toggle remounts the timeline but keeps the zoom the user set', () => {
    const props = baseProps();
    const { rerender } = render(<AnnotateModeView {...props} />);
    fireEvent.click(screen.getByTestId('zin'));
    fireEvent.click(screen.getByTestId('zin'));
    fireEvent.click(screen.getByTestId('zin'));
    expect(zoomOf()).toBe('175');
    rerender(<AnnotateModeView {...props} annotateFullscreen={true} />);
    expect(zoomOf()).toBe('175');
    rerender(<AnnotateModeView {...props} annotateFullscreen={false} />);
    expect(zoomOf()).toBe('175');
  });
});
