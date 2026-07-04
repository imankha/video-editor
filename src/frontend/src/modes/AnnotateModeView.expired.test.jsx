import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

/**
 * bug 27p: when a game's source video has expired (R2 source hard-deleted
 * post-grace), the Annotate player must show a deliberate "source expired" state
 * instead of mounting a <video> against the dead source (broken/hanging player).
 * The annotations sidebar is owned by AnnotateScreen and is unaffected here.
 */

// Stub heavy children — we only assert which video-area branch renders.
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
    ...overrides,
  };
  return render(<AnnotateModeView {...props} />);
}

describe('AnnotateModeView source-expired state (bug 27p)', () => {
  it('renders a deliberate expired state and no video player when the source expired', () => {
    renderView({ isSourceExpired: true });

    // getByText throws if absent, so these are assertions in themselves.
    expect(screen.getByText(/source video expired/i)).toBeTruthy();
    expect(screen.getByText(/your annotations are still listed/i)).toBeTruthy();
    // The broken/hanging player must not mount against the dead source.
    expect(screen.queryByTestId('video-player')).toBeNull();
  });

  it('renders the normal player and no expired state for a non-expired game', () => {
    renderView({ isSourceExpired: false });

    expect(screen.getByTestId('video-player')).toBeTruthy();
    expect(screen.queryByText(/source video expired/i)).toBeNull();
  });

  it('disables "Playback Annotations" for an expired game so playback never mounts the dead source', () => {
    // Expired game WITH clips: the button would otherwise be enabled and entering
    // playback mounts dual <video> against the hard-deleted source.
    renderView({ isSourceExpired: true, hasAnnotateClips: true });

    const btn = screen.getByRole('button', { name: /playback annotations/i });
    expect(btn.disabled).toBe(true);
  });

  it('keeps "Playback Annotations" enabled for a non-expired game with clips', () => {
    renderView({ isSourceExpired: false, hasAnnotateClips: true });

    const btn = screen.getByRole('button', { name: /playback annotations/i });
    expect(btn.disabled).toBe(false);
  });
});
