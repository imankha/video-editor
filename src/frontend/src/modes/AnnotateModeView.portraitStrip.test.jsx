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
// windowed mobile editor uses, below the video, never over it. T15370 gave
// landscape mobile fullscreen its own side-strip cockpit grid (the picture is
// no longer full-bleed there either): the editor now opens as a right-anchored
// sheet beside the picture instead of a bottom sheet on top of it.
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

  it('landscape fullscreen + editor open renders the landscape-inline sheet beside the picture, not full-bleed over it (T15370)', () => {
    isLandscapeMock = true;
    render(<AnnotateModeView {...buildProps({ annotateFullscreen: true })} />);
    expect(screen.getByTestId('overlay-layout').textContent).toBe('landscape-inline');
    // T15370: the picture is never marked full-bleed in the landscape cockpit.
    expect(screen.getByTestId('annotate-coach-stage').getAttribute('data-full-bleed-video')).toBeNull();
    // The side sheet is absolutely positioned inside the grid, right-anchored
    // beside the picture (never a bottom sheet drawn on top of it).
    expect(screen.getByTestId('overlay-layout').closest('[class*="absolute"]')).toBeTruthy();
  });
});

// T15750 (AC1): portrait mobile fullscreen's Edit/Add play editor used to be
// able to squeeze the video wrapper (flex-1 min-h-0, no floor) down to almost
// nothing while the generic fullscreen timeline AND the editor panel both
// stayed at their full/shrink-0 size. The video wrapper now gets a guaranteed
// min-height floor and the editor panel yields (shrink, not shrink-0); the
// timeline hides the same way the T15370 landscape cockpit already hides its
// own timeline row while editing.
describe('AnnotateModeView — portrait fullscreen editor never squeezes the picture below a usable size (T15750)', () => {
  beforeEach(() => { isMobileMock = true; isLandscapeMock = false; });

  it('gives the video wrapper a min-height floor while the editor is open', () => {
    render(<AnnotateModeView {...buildProps({ annotateFullscreen: true, showAnnotateOverlay: true })} />);
    expect(screen.getByTestId('annotate-video-wrapper').className).toMatch(/min-h-\[56\.25vw\]/);
  });

  it('does not reserve a floor when the editor is closed (nothing competes for the space)', () => {
    render(<AnnotateModeView {...buildProps({ annotateFullscreen: true, showAnnotateOverlay: false })} />);
    expect(screen.getByTestId('annotate-video-wrapper').className).not.toMatch(/min-h-\[56\.25vw\]/);
  });

  it('hides the generic fullscreen timeline while the portrait editor is open, freeing its space for the picture', () => {
    render(<AnnotateModeView {...buildProps({ annotateFullscreen: true, showAnnotateOverlay: true })} />);
    expect(screen.queryByTestId('annotate-fullscreen-timeline')).toBeNull();
  });

  it('shows the generic fullscreen timeline when the editor is closed', () => {
    render(<AnnotateModeView {...buildProps({ annotateFullscreen: true, showAnnotateOverlay: false })} />);
    expect(screen.queryByTestId('annotate-fullscreen-timeline')).toBeTruthy();
  });

  it('lets the editor panel shrink (not shrink-0) so the video wrapper keeps its floor', () => {
    render(<AnnotateModeView {...buildProps({ annotateFullscreen: true, showAnnotateOverlay: true })} />);
    const overlayPanel = screen.getByTestId('overlay-layout').closest('[class*="max-h-[45vh]"]');
    expect(overlayPanel).toBeTruthy();
    expect(overlayPanel.className).toMatch(/\bshrink\b/);
    expect(overlayPanel.className).not.toMatch(/shrink-0/);
  });
});
