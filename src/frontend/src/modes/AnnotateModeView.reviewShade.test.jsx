import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * T13180: Review plays dimmed the playing video. The rule's shadeClear named
 * `annotate-coach-stage video`, but the playback (review) layout never renders that stage,
 * so the selector matched nothing and the shade had no video cutout. Mount the REAL review
 * layout and require the rule's shadeClear to find the on-screen video there.
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
import { resolveGuide } from '../components/instructions/resolveGuide';
import { annotateFacts } from '../components/instructions/catalog';
import { GUIDE_PULSE, GUIDE_PULSE_CLASS } from '../components/instructions/guideTargets';
import { useSettingsStore } from '../stores/settingsStore';

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

describe('T13180: Review plays keeps the playing video out of the shade', () => {
  beforeEach(() => { useSettingsStore.getState().setFromBootstrap({ guidance: { coachEnabled: true } }); });
  afterEach(() => { cleanup(); useSettingsStore.getState().reset(); });

  const reviewGuide = () => resolveGuide(annotateFacts(null, [], { reviewing: true, playCount: 1 }));

  it('the review rule\'s shadeClear matches the video the review layout renders', () => {
    const { container } = renderView({ playback: playbackActive, gameId: 1, onSharePlayback: vi.fn() });
    const guide = reviewGuide();
    expect(guide.id).toBe('annotate.review');
    const matched = guide.shadeClear.flatMap((sel) => [...container.querySelectorAll(sel)]);
    expect(matched.length).toBeGreaterThan(0);
    const videos = [...container.querySelectorAll('video')];
    expect(videos.length).toBeGreaterThan(0);
    videos.forEach((v) => expect(matched.some((m) => m === v || m.contains(v))).toBe(true));
  });

  it('Share plays stays the pulsing target', () => {
    renderView({ playback: playbackActive, gameId: 1, onSharePlayback: vi.fn() });
    expect(reviewGuide().pulse).toBe(GUIDE_PULSE.SHARE_PLAYS);
    expect(screen.getByTestId('annotate-share-plays').className).toContain(GUIDE_PULSE_CLASS);
  });
});
