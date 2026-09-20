import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

/**
 * T10393 (user request): Add footage moved off the timeline's compact
 * Video-timeline-cell trigger (T10390 — "not prominent enough to ever get
 * clicked") into the whole-game CTA row, as a third button alongside Preview
 * plays / Share plays. Two states there: the full row (clips exist) gets a
 * full-size button; the de-emphasized zero-clips row gets a small text link
 * matching its Preview/Share siblings' own de-emphasized style.
 */

vi.mock('../components/VideoPlayer', () => ({
  VideoPlayer: () => <div data-testid="video-player" />,
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
vi.mock('./annotate/AddFootageButton', () => ({
  default: ({ gameId, disabled, variant }) => (
    <button
      type="button"
      data-testid="add-footage-button"
      data-variant={variant || 'row'}
      disabled={disabled}
    >
      Add footage {gameId}
    </button>
  ),
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
    addFootage: { gameId: 'g1', disabled: false, onFootageAttached: vi.fn() },
    ...overrides,
  };
  return render(<AnnotateModeView {...props} />);
}

describe('AnnotateModeView — Add footage in the whole-game CTA row (T10393)', () => {
  it('renders the full-size trigger alongside Preview/Share once clips exist', () => {
    renderView({ hasAnnotateClips: true, onSharePlayback: vi.fn() });
    const trigger = screen.getByTestId('add-footage-button');
    expect(trigger).toBeTruthy();
    expect(trigger.getAttribute('data-variant')).toBe('row');
    expect(screen.getByRole('button', { name: /review plays/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /share plays/i })).toBeTruthy();
  });

  it('renders the de-emphasized link variant in the zero-clips state', () => {
    renderView({ hasAnnotateClips: false });
    const trigger = screen.getByTestId('add-footage-button');
    expect(trigger.getAttribute('data-variant')).toBe('link');
  });

  it('passes disabled through', () => {
    renderView({
      hasAnnotateClips: true,
      addFootage: { gameId: 'g1', disabled: true, onFootageAttached: vi.fn() },
    });
    expect(screen.getByTestId('add-footage-button').disabled).toBe(true);
  });

  it('renders nothing when no addFootage context is given', () => {
    renderView({ hasAnnotateClips: true, addFootage: null });
    expect(screen.queryByTestId('add-footage-button')).toBeNull();
  });

  it('hides the whole row (Add footage included) once a play is selected', () => {
    renderView({
      isEditMode: true,
      hasAnnotateClips: true,
      clipRegions: [{ id: 'r1', startTime: 0, endTime: 5, autoProjectId: null }],
      annotateSelectedRegionId: 'r1',
    });
    expect(screen.queryByTestId('add-footage-button')).toBeNull();
  });
});
