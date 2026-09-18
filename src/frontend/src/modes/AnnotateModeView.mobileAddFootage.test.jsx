import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

/**
 * T10380 — on mobile there's no room for a settings rail, so Add footage keeps a
 * single-button row above the canvas (unchanged from before; only Zoom moved out,
 * and Zoom was always desktop-only there anyway). Companion to
 * AnnotateModeView.settingsRail.test.jsx, which covers the desktop rail.
 */

vi.mock('../components/VideoPlayer', () => ({
  VideoPlayer: () => <div data-testid="video-player" />,
}));
vi.mock('../components/shared/VideoLoadingOverlay', () => ({
  VideoLoadingOverlay: () => <div />,
}));
vi.mock('../components/ZoomControls', () => ({
  default: () => <div data-testid="zoom-controls" />,
}));
vi.mock('./annotate/AddFootageButton', () => ({
  default: ({ gameId }) => <button data-testid="add-footage-button">Add footage {gameId}</button>,
}));
vi.mock('./annotate', () => ({
  AnnotateMode: () => <div data-testid="annotate-timeline" />,
  AnnotateControls: () => <div />,
  NotesOverlay: () => <div />,
  AnnotateFullscreenOverlay: () => <div data-testid="clip-editor" />,
}));
vi.mock('./annotate/components/PlaybackControls', () => ({ default: () => <div /> }));
vi.mock('../components/shared', () => ({
  Button: ({ children }) => <button>{children}</button>,
}));
vi.mock('../hooks/useIsMobile', () => ({
  useIsMobile: () => true,
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

describe('AnnotateModeView mobile Add footage row (T10380)', () => {
  it('renders Add footage above the canvas with no settings rail or Zoom on mobile', () => {
    renderView();
    expect(screen.getByTestId('add-footage-button')).toBeTruthy();
    expect(screen.queryByTestId('settings-rail')).toBeNull();
    expect(screen.queryByTestId('zoom-controls')).toBeNull();
  });

  it('hides Add footage while the under-canvas editor is open', () => {
    renderView({ showAnnotateOverlay: true });
    expect(screen.queryByTestId('add-footage-button')).toBeNull();
  });

  it('renders nothing when no addFootage context is provided', () => {
    renderView({ addFootage: null });
    expect(screen.queryByTestId('add-footage-button')).toBeNull();
  });
});
