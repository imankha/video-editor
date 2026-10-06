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
    <div data-testid="timeline" data-zoom={zoom?.timelineZoom} data-center-key={zoom?.centerPlayheadKey} data-hide-chip={String(zoom?.hideChip)}>
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

// T11860: the phone default is 100% while the game has 0 plays (nothing to make
// legible yet) and 300% from the first play (T10780's reason for 300% only
// applies once plays exist). The first play also centers the playhead.
describe('AnnotateModeView first-run timeline zoom (T11860)', () => {
  const firstRun = { hasAnnotateClips: false, isFirstRun: true, simplifiedControls: true, onShowAllControls: vi.fn() };
  const withPlays = { hasAnnotateClips: true, isFirstRun: false, simplifiedControls: false, onShowAllControls: vi.fn() };
  const centerKey = () => screen.getByTestId('timeline').getAttribute('data-center-key');

  beforeEach(() => { mobile.value = false; });

  it('phone with 0 plays opens at 100%; the first play moves it to 300% and bumps the center key', () => {
    mobile.value = true;
    const { rerender } = render(<AnnotateModeView {...baseProps(firstRun)} />);
    expect(zoomOf()).toBe('100');
    const before = centerKey();
    rerender(<AnnotateModeView {...baseProps(withPlays)} />);
    expect(zoomOf()).toBe('300');
    expect(centerKey()).not.toBe(before);
  });

  it('deleting the last play keeps an untouched phone zoom at 300% (default latched)', () => {
    mobile.value = true;
    const { rerender } = render(<AnnotateModeView {...baseProps(firstRun)} />);
    rerender(<AnnotateModeView {...baseProps(withPlays)} />);
    expect(zoomOf()).toBe('300');
    // last play deleted: first-run again, chrome stays revealed (latched upstream)
    rerender(<AnnotateModeView {...baseProps({ ...firstRun, simplifiedControls: false })} />);
    expect(zoomOf()).toBe('300');
  });

  it('phone with existing plays opens at 300% and does not bump the center key on mount', () => {
    mobile.value = true;
    render(<AnnotateModeView {...baseProps(withPlays)} />);
    expect(zoomOf()).toBe('300');
    expect(centerKey()).toBe('0');
  });

  it('a zoom the user set on a fresh game is kept when the first play arrives', () => {
    mobile.value = true;
    const { rerender } = render(<AnnotateModeView {...baseProps({ ...firstRun, simplifiedControls: false })} />);
    fireEvent.click(screen.getByTestId('zin'));
    expect(zoomOf()).toBe('125');
    rerender(<AnnotateModeView {...baseProps(withPlays)} />);
    expect(zoomOf()).toBe('125');
  });

  it('reset returns to the current default: 300% on a phone with plays', () => {
    mobile.value = true;
    render(<AnnotateModeView {...baseProps(withPlays)} />);
    fireEvent.click(screen.getByTestId('zin'));
    expect(zoomOf()).toBe('325');
    fireEvent.click(screen.getByTestId('zreset'));
    expect(zoomOf()).toBe('300');
  });

  it('desktop stays at 100% before and after the first play', () => {
    const { rerender } = render(<AnnotateModeView {...baseProps(firstRun)} />);
    expect(zoomOf()).toBe('100');
    rerender(<AnnotateModeView {...baseProps(withPlays)} />);
    expect(zoomOf()).toBe('100');
  });

  it('hides the zoom chip only while the controls are simplified', () => {
    const { rerender } = render(<AnnotateModeView {...baseProps(firstRun)} />);
    expect(screen.getByTestId('timeline').getAttribute('data-hide-chip')).toBe('true');
    rerender(<AnnotateModeView {...baseProps(withPlays)} />);
    expect(screen.getByTestId('timeline').getAttribute('data-hide-chip')).toBe('false');
  });
});
