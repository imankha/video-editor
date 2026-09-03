import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

/**
 * T8600 §2.5 — render-site inventory. All four AnnotateFullscreenOverlay
 * render sites must pass both `existingClip` (T8590 invariant) and `surface`
 * (beacon discriminator) — a render site that forgets either silently
 * regresses to the pre-T8590/T8600 bug shape with no error.
 */

let mockIsMobile = false;

vi.mock('../components/VideoPlayer', () => ({
  VideoPlayer: () => <div data-testid="video-player" />,
}));
vi.mock('../components/shared/VideoLoadingOverlay', () => ({
  VideoLoadingOverlay: () => <div />,
}));
vi.mock('../components/ZoomControls', () => ({ default: () => <div /> }));
vi.mock('./annotate', () => ({
  AnnotateMode: () => <div data-testid="timeline" />,
  AnnotateControls: () => <div />,
  NotesOverlay: () => <div />,
  AnnotateFullscreenOverlay: (props) => (
    <div data-testid="overlay-render" data-layout={props.layout} data-surface={props.surface}>
      {props.existingClip ? `existingClip:${props.existingClip.id}` : 'existingClip:null'}
    </div>
  ),
}));
vi.mock('./annotate/components/PlaybackControls', () => ({ default: () => <div /> }));
vi.mock('../components/shared', () => ({
  Button: ({ children }) => <button>{children}</button>,
}));
vi.mock('../hooks/useIsMobile', () => ({
  useIsMobile: () => mockIsMobile,
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

const clipRegions = [
  { id: 'c1', startTime: 10, endTime: 20, videoSequence: 1, my_athlete: true, name: 'Great Pass', rating: 5 },
];

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
    showAnnotateOverlay: true,
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
    annotateSelectedRegionId: 'c1',
    hasAnnotateClips: true,
    clipRegions,
    isEditMode: true,
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

describe('AnnotateFullscreenOverlay render-site inventory (T8600 §2.5, T8590)', () => {
  it('desktop fullscreen dock: surface=dock_fullscreen, existingClip present', () => {
    mockIsMobile = false;
    renderView({ annotateFullscreen: true });
    const el = screen.getByTestId('overlay-render');
    expect(el.dataset.surface).toBe('dock_fullscreen');
    expect(el.textContent).toBe('existingClip:c1');
  });

  it('mobile fullscreen sheet: surface=fullscreen_mobile, existingClip present', () => {
    mockIsMobile = true;
    renderView({ annotateFullscreen: true });
    const el = screen.getByTestId('overlay-render');
    expect(el.dataset.surface).toBe('fullscreen_mobile');
    expect(el.textContent).toBe('existingClip:c1');
  });

  it('mobile bottom sheet: surface=sheet_mobile, existingClip present', () => {
    mockIsMobile = true;
    renderView({ annotateFullscreen: false });
    const el = screen.getByTestId('overlay-render');
    expect(el.dataset.surface).toBe('sheet_mobile');
    expect(el.textContent).toBe('existingClip:c1');
  });

  it('desktop strip: surface=inline_desktop, existingClip present', () => {
    mockIsMobile = false;
    renderView({ annotateFullscreen: false });
    const el = screen.getByTestId('overlay-render');
    expect(el.dataset.surface).toBe('inline_desktop');
    expect(el.textContent).toBe('existingClip:c1');
  });
});
