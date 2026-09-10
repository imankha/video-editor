import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

/**
 * T9350 — Add footage + Zoom share one toolbar row above the video canvas.
 *
 * "Add footage" moved OUT of the timeline header row (T8910) into a new toolbar
 * row that sits above the canvas, paired with the Zoom control on the right. The
 * button must hide while the under-canvas editor is open (matching its old
 * timeline-header visibility) and the whole row must be gone when no video is
 * loaded.
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

describe('AnnotateModeView toolbar row (T9350)', () => {
  it('renders Add footage and Zoom together in a row above the canvas', () => {
    renderView();
    const addFootage = screen.getByTestId('add-footage-button');
    const zoom = screen.getByTestId('zoom-controls');
    expect(addFootage).toBeTruthy();
    expect(zoom).toBeTruthy();
    // Same toolbar row (Add footage is the row; Zoom is nested within it), and the
    // row sits before the video player in DOM order.
    expect(addFootage.parentElement.contains(zoom)).toBe(true);
    const player = screen.getByTestId('video-player');
    expect(addFootage.compareDocumentPosition(player) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('does not render Add footage inside the timeline header anymore', () => {
    renderView();
    // Exactly one Add footage button on the surface (the toolbar one), not two.
    expect(screen.getAllByTestId('add-footage-button')).toHaveLength(1);
  });

  it('hides Add footage while the under-canvas editor is open, but keeps Zoom', () => {
    renderView({ showAnnotateOverlay: true }); // underCanvasEditor (desktop, non-fullscreen)
    expect(screen.queryByTestId('add-footage-button')).toBeNull();
    expect(screen.getByTestId('zoom-controls')).toBeTruthy();
  });

  it('drops the whole toolbar row when no video is loaded', () => {
    renderView({ annotateVideoUrl: null });
    expect(screen.queryByTestId('add-footage-button')).toBeNull();
    expect(screen.queryByTestId('zoom-controls')).toBeNull();
  });

  it('does not render Add footage when no addFootage context is provided', () => {
    renderView({ addFootage: null });
    expect(screen.queryByTestId('add-footage-button')).toBeNull();
    // Zoom still anchors the row.
    expect(screen.getByTestId('zoom-controls')).toBeTruthy();
  });
});
