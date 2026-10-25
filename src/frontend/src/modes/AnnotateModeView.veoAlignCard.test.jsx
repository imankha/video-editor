import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

/**
 * T13240/T13245 (user request 2026-10-25): after importing Veo highlights, the alignment check
 * ("Does the play start here?") must be seen WITH the video it asks about. It used to render under
 * the timeline and the action cards, ~650 px below the player (off-screen at 900 px tall), so it
 * now sits directly under the transport, before the action-card row and the suggestions list.
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

const follows = (a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

function suggested(withAlign) {
  return {
    sheet: null,
    align: withAlign ? { onShift: vi.fn(), onDone: vi.fn(), onRemove: vi.fn() } : null,
    ticks: [],
    onTickClick: vi.fn(),
    list: { suggestions: [], keptDetails: {} },
  };
}

describe('AnnotateModeView: Veo alignment card placement', () => {
  it('renders the alignment card under the player, before the action cards', () => {
    renderView({ suggested: suggested(true) });
    const card = screen.getByTestId('veo-align-card');
    expect(follows(screen.getByTestId('video-player'), card)).toBe(true);
    expect(follows(card, screen.getByTestId('add-footage-button'))).toBe(true);
    expect(screen.getAllByTestId('veo-align-card')).toHaveLength(1);
  });

  it('renders no alignment card when there is no fresh import', () => {
    renderView({ suggested: suggested(false) });
    expect(screen.queryByTestId('veo-align-card')).toBeNull();
  });
});
