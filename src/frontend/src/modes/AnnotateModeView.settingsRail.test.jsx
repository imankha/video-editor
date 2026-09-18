import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

/**
 * T10380 — Add footage + Zoom move into a right-side settings rail on desktop,
 * mirroring Focus/Overlay's SettingsRail. Supersedes T9350's above-canvas toolbar
 * row (see AnnotateModeView.mobileAddFootage.test.jsx for the mobile-only row that
 * remains — the rail itself is desktop-only, `hidden lg:flex`).
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

describe('AnnotateModeView settings rail (T10380)', () => {
  it('renders the settings rail with Zoom, and Add footage above it, not as a row over the canvas', () => {
    renderView();
    const rail = screen.getByTestId('settings-rail');
    const zoom = screen.getByTestId('zoom-controls');
    const addFootage = screen.getByTestId('add-footage-button');
    expect(rail.contains(zoom)).toBe(true);
    // Add footage lives in the rail's own column (a sibling header above the rail
    // body), never inside the rail's settings body itself.
    expect(rail.contains(addFootage)).toBe(false);
    const player = screen.getByTestId('video-player');
    // Rail column follows the video in DOM order (it's the second flex child).
    expect(player.compareDocumentPosition(rail) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('hides Add footage while the under-canvas editor is open, but keeps Zoom (rail is permanent)', () => {
    renderView({ showAnnotateOverlay: true }); // underCanvasEditor (desktop, non-fullscreen)
    expect(screen.queryByTestId('add-footage-button')).toBeNull();
    expect(screen.getByTestId('zoom-controls')).toBeTruthy();
    expect(screen.getByTestId('settings-rail')).toBeTruthy();
  });

  it('drops the rail entirely when no video is loaded', () => {
    renderView({ annotateVideoUrl: null });
    expect(screen.queryByTestId('add-footage-button')).toBeNull();
    expect(screen.queryByTestId('settings-rail')).toBeNull();
  });

  it('does not render Add footage when no addFootage context is provided, but Zoom still anchors the rail', () => {
    renderView({ addFootage: null });
    expect(screen.queryByTestId('add-footage-button')).toBeNull();
    expect(screen.getByTestId('zoom-controls')).toBeTruthy();
  });

  it('drops the rail (and the video) in fullscreen, matching the old toolbar row behavior', () => {
    renderView({ annotateFullscreen: true });
    expect(screen.queryByTestId('settings-rail')).toBeNull();
  });

  it('collapsing the rail also hides Add footage (no icon-only fallback today — documented, not a bug)', () => {
    renderView();
    expect(screen.getByTestId('add-footage-button')).toBeTruthy();
    fireEvent.click(screen.getByTestId('rail-collapse-toggle'));
    expect(screen.queryByTestId('add-footage-button')).toBeNull();
    // The rail itself survives collapse (icon-only strip), unlike Add footage.
    expect(screen.getByTestId('settings-rail')).toBeTruthy();
  });
});
