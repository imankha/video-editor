import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

/**
 * T15460: non-fullscreen Annotate in landscape at phone heights (<=500px, e.g. iPhone
 * 844x390) stacked the full desktop layout with nothing to shrink it, pushing Mark play
 * off screen (AC1). Separately, SHORT_DESKTOP_* (T13020/T13170/T13530, meant for short
 * DESKTOP windows) had no pointer gate, so an iPad gen 7 landscape (1024x768, coarse
 * pointer) matched it too and got squeezed to a 21vh stage box it didn't need (AC2).
 */

vi.mock('../components/VideoPlayer', () => ({
  VideoPlayer: (props) => (
    <div data-testid="video-player" data-fit-to-aspect={String(props.fitToAspect)} />
  ),
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
    gameId: 7,
    ...overrides,
  };
  return render(<AnnotateModeView {...props} />);
}

const stageBox = () => screen.getByTestId('video-player').parentElement;

describe('T15460 AnnotateModeView phone-landscape (non-fullscreen) compaction', () => {
  it('AC1: stage box class caps height for narrow landscape phones independent of hover/pointer', () => {
    renderView({ annotateVideoMetadata: { width: 1920, height: 1080 } });
    const box = stageBox();
    expect(box.className).toContain(
      '[@media(max-width:1023px)_and_(orientation:landscape)_and_(max-height:500px)]:!h-[12dvh]'
    );
    expect(box.className).toContain(
      '[@media(max-width:1023px)_and_(orientation:landscape)_and_(max-height:500px)]:!max-h-[12dvh]'
    );
  });

  it('AC2: SHORT_DESKTOP stage compaction requires a real mouse (hover:hover and pointer:fine), excluding touch tablets', () => {
    renderView({ annotateVideoMetadata: { width: 1920, height: 1080 } });
    const box = stageBox();
    expect(box.className).toContain(
      '[@media(min-width:1024px)_and_(max-height:800px)_and_(hover:hover)_and_(pointer:fine)]:!h-[21vh]'
    );
  });
});
