import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// T10620: the play editor's mobile-portrait vs desktop split is decided by
// useIsMobile (max-width 1023px OR coarse pointer — T10590 finding 2), NOT a
// Tailwind `sm:` breakpoint. When mobile + the editor is open (windowed), the
// overlay renders as the in-flow `portrait-strip`; on desktop it renders the
// under-canvas `strip`. This pins the gate to useIsMobile by mocking it and
// echoing the `layout` prop the overlay receives.

vi.mock('../components/VideoPlayer', () => ({ VideoPlayer: () => <div data-testid="video-player" /> }));
vi.mock('../components/shared/VideoLoadingOverlay', () => ({ VideoLoadingOverlay: () => <div /> }));
vi.mock('../components/ZoomControls', () => ({ default: () => <div /> }));
vi.mock('./annotate', () => ({
  AnnotateMode: () => <div />,
  AnnotateControls: () => <div />,
  NotesOverlay: () => <div />,
  // Echo the layout prop so the test can assert which editor surface renders.
  AnnotateFullscreenOverlay: ({ layout }) => <div data-testid="overlay-layout">{layout}</div>,
}));
vi.mock('./annotate/components/PlaybackControls', () => ({ default: () => <div /> }));
vi.mock('../components/shared', () => ({ Button: ({ children }) => <button>{children}</button> }));

let isMobileMock = false;
let isLandscapeMock = false;
vi.mock('../hooks/useIsMobile', () => ({
  useIsMobile: () => isMobileMock,
  useIsLandscape: () => isLandscapeMock,
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

vi.mock('../stores', () => ({
  useCurrentProfile: () => ({ id: 'p1', sport: 'soccer' }),
  useProfileStore: (selector) => selector({ updateProfile: vi.fn() }),
  useProjectsList: () => [],
}));

import { AnnotateModeView } from './AnnotateModeView';

function buildProps(overrides = {}) {
  return {
    videoController: { _renderRefs: { videoARef: { current: null }, videoBRef: { current: null } } },
    annotateVideoUrl: '/api/games/1/video',
    annotateVideoMetadata: { width: 1920, height: 1080, duration: 100, format: 'mp4', size: 0 },
    annotateContainerRef: { current: null },
    currentTime: 0,
    duration: 100,
    isPlaying: false,
    handlers: {},
    annotateFullscreen: false,
    showAnnotateOverlay: true, // editor open
    existingClip: { id: 'c1', startTime: 0, endTime: 10, rating: 4, tags: [], notes: '', name: 'Play 1', my_athlete: true, tagged_teammates: [] },
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
    clipRegions: [{ id: 'c1', startTime: 0, endTime: 10, autoProjectId: null }],
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
    onFullscreenUpdateClip: vi.fn(),
    onOpenClipInFocus: vi.fn(),
    onOpenClipInOverlay: vi.fn(),
    onOverlayClose: vi.fn(),
    onDeletePlayFromEditor: vi.fn(),
    onAwaitRegionWrites: vi.fn(),
    writeStatus: 'idle',
    ...overrides,
  };
}

describe('AnnotateModeView — useIsMobile decides the editor split (T10620)', () => {
  beforeEach(() => { isMobileMock = false; isLandscapeMock = false; });

  it('mobile + editor open (windowed) renders the in-flow portrait-strip', () => {
    isMobileMock = true;
    render(<AnnotateModeView {...buildProps()} />);
    expect(screen.getByTestId('overlay-layout').textContent).toBe('portrait-strip');
  });

  it('desktop + editor open renders the under-canvas strip, never portrait-strip', () => {
    isMobileMock = false;
    render(<AnnotateModeView {...buildProps()} />);
    expect(screen.getByTestId('overlay-layout').textContent).toBe('strip');
  });
});

// T15380 (AC1/AC2): mobile fullscreen PORTRAIT stopped covering the video with
// an absolute sheet -- the editor joins the SAME in-flow portrait-strip the
// windowed mobile editor uses, below the video, never over it. Landscape mobile
// fullscreen is unchanged by this task (still a `data-full-bleed-video`, fixed
// `landscape-inline` sheet on top of the video) -- the side-strip redesign is
// the T15370 follow-up.
describe('AnnotateModeView — mobile FULLSCREEN editor split by orientation (T15380)', () => {
  beforeEach(() => { isMobileMock = true; isLandscapeMock = false; });

  it('portrait fullscreen + editor open renders in-flow portrait-strip, not a full-bleed sheet', () => {
    render(<AnnotateModeView {...buildProps({ annotateFullscreen: true })} />);
    expect(screen.getByTestId('overlay-layout').textContent).toBe('portrait-strip');
    // AC1: nothing marks the video as full-bleed once the editor lives below it.
    expect(screen.getByTestId('annotate-coach-stage').getAttribute('data-full-bleed-video')).toBeNull();
  });

  it('portrait fullscreen editor panel is an in-flow block, not an absolute overlay sheet', () => {
    render(<AnnotateModeView {...buildProps({ annotateFullscreen: true })} />);
    const overlay = screen.getByTestId('overlay-layout');
    // The portrait-strip panel wraps in a plain shrink-0 block (shares the
    // desktop fullscreen strip's in-flow treatment); it must never carry the
    // `absolute inset-x-0 bottom-0` sheet classes landscape still uses.
    expect(overlay.closest('[class*="absolute"]')).toBeNull();
  });

  it('landscape fullscreen + editor open still renders the full-bleed landscape-inline sheet', () => {
    isLandscapeMock = true;
    render(<AnnotateModeView {...buildProps({ annotateFullscreen: true })} />);
    expect(screen.getByTestId('overlay-layout').textContent).toBe('landscape-inline');
    expect(screen.getByTestId('annotate-coach-stage').getAttribute('data-full-bleed-video')).toBe('true');
    expect(screen.getByTestId('overlay-layout').closest('[class*="absolute"]')).toBeTruthy();
  });
});
