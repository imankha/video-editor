import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

/**
 * T8970 item 4: Playback Annotations mode must be visually unambiguous vs
 * Annotate mode. A persistent "Playback Annotations" badge renders on the
 * playback container the whole time the mode is active (not just on the entry
 * button), and never in normal annotate mode.
 */

vi.mock('../components/VideoPlayer', () => ({ VideoPlayer: () => <div data-testid="video-player" /> }));
vi.mock('../components/shared/VideoLoadingOverlay', () => ({ VideoLoadingOverlay: () => <div /> }));
vi.mock('../components/ZoomControls', () => ({ default: () => <div /> }));
vi.mock('./annotate', () => ({
  AnnotateMode: () => <div data-testid="timeline" />,
  AnnotateControls: () => <div data-testid="controls" />,
  NotesOverlay: () => <div />,
  AnnotateFullscreenOverlay: () => <div data-testid="overlay" />,
}));
vi.mock('./annotate/components/PlaybackControls', () => ({ default: () => <div data-testid="playback-controls" /> }));
vi.mock('../components/shared', () => ({ Button: ({ children }) => <button>{children}</button> }));
vi.mock('../hooks/useIsMobile', () => ({ useIsMobile: () => false, useIsLandscape: () => false }));
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

const clipRegions = [
  { id: 'c1', startTime: 10, endTime: 20, videoSequence: 1, my_athlete: true, name: 'Great Pass', rating: 5 },
];

const playbackActive = {
  isPlaybackMode: true,
  activeVideoLabel: 'A',
  isLoading: false,
  isPlaying: false,
  activeClipId: 'c1',
  virtualTime: 0,
  playbackRate: 1,
  videoARef: { current: null },
  videoBRef: { current: null },
  timeline: { totalVirtualDuration: 20, segments: [] },
  getCurrentSegment: () => null,
  togglePlay: vi.fn(),
  restart: vi.fn(),
  seekVirtual: vi.fn(),
  seekWithinSegment: vi.fn(),
  startScrub: vi.fn(),
  endScrub: vi.fn(),
  changePlaybackRate: vi.fn(),
  videoController: { _renderRefs: {} },
};

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
    hasAnnotateClips: true,
    clipRegions,
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
  return render(<AnnotateModeView {...props} />);
}

describe('AnnotateModeView — persistent Playback Annotations badge (T8970 item 4)', () => {
  it('renders the mode badge while in playback mode', () => {
    renderView({ playback: playbackActive });
    const badge = screen.getByTestId('playback-mode-badge');
    expect(badge).toBeTruthy();
    expect(badge.textContent).toMatch(/Playback Annotations/i);
  });

  it('does NOT render the mode badge in normal annotate mode', () => {
    renderView({ playback: { isPlaybackMode: false, enterPlaybackMode: vi.fn() } });
    expect(screen.queryByTestId('playback-mode-badge')).toBeNull();
  });
});
