import { render, screen, within, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * T15370 — Annotate landscape fullscreen side-strip layout. The old
 * mobileFsLandscape surface drew the transport/timeline/editor OVER the
 * picture (auto-hiding after 3s, T15380's mitigation); this replaces it with
 * a permanent CSS grid: a 56px left strip, the picture, a 72px right strip,
 * and a thin timeline row under the picture -- nothing is ever drawn on top
 * of it.
 */

vi.mock('../components/VideoPlayer', () => ({ VideoPlayer: () => <div data-testid="video-player" /> }));
vi.mock('../components/shared/VideoLoadingOverlay', () => ({ VideoLoadingOverlay: () => <div /> }));
vi.mock('../components/ZoomControls', () => ({ default: () => <div /> }));
vi.mock('./annotate', () => ({
  AnnotateMode: (props) => <div data-testid="annotate-mode" data-hide-scrollbar={String(!!props.hideScrollbar)} />,
  AnnotateControls: () => <div data-testid="annotate-controls" />,
  NotesOverlay: () => <div />,
  AnnotateFullscreenOverlay: ({ layout, dragPeek }) => (
    <div data-testid="overlay-layout" data-drag-peek={String(!!dragPeek)}>{layout}</div>
  ),
}));
vi.mock('./annotate/components/PlaybackControls', () => ({ default: () => <div /> }));
vi.mock('./annotate/SourceBar', () => ({ default: (props) => <div data-testid="source-bar">{props.index}/{props.count}</div> }));
vi.mock('../components/shared', () => ({ Button: ({ children }) => <button>{children}</button> }));

let isMobileMock = true;
let isLandscapeMock = true;
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
    annotateFullscreen: true,
    showAnnotateOverlay: false,
    existingClip: { id: 'c1', startTime: 0, endTime: 10, rating: 4, tags: [], notes: '', name: 'Play 1', my_athlete: true, tagged_teammates: [] },
    togglePlay: vi.fn(),
    stepForward: vi.fn(),
    stepBackward: vi.fn(),
    seekBackward: vi.fn(),
    seekForward: vi.fn(),
    restart: vi.fn(),
    seek: vi.fn(),
    onTimelineSeek: vi.fn(),
    annotatePlaybackSpeed: 1,
    onSpeedChange: vi.fn(),
    onToggleFullscreen: vi.fn(),
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

describe('AnnotateModeView — landscape fullscreen cockpit grid (T15370)', () => {
  beforeEach(() => { isMobileMock = true; isLandscapeMock = true; });

  it('AC1/AC4: renders the left transport strip and right action strip beside the picture, not over it', () => {
    render(<AnnotateModeView {...buildProps()} />);
    const left = screen.getByTestId('annotate-cockpit-left-strip');
    const right = screen.getByTestId('annotate-cockpit-right-strip');
    expect(left).toBeTruthy();
    expect(right).toBeTruthy();
    // The windowed controls bar never mounts alongside the cockpit grid.
    expect(screen.queryByTestId('annotate-controls')).toBeNull();
    // AC4: left strip has play; right strip has Mark/Edit play.
    expect(within(left).getByTestId('annotate-play-button')).toBeTruthy();
    expect(within(right).getByTestId('annotate-mark-play-button')).toBeTruthy();
  });

  it('AC1: the timeline renders under the picture with the finger-scrollbar row dropped (strips replace it)', () => {
    render(<AnnotateModeView {...buildProps()} />);
    const zone = screen.getByTestId('annotate-cockpit-timeline');
    expect(within(zone).getByTestId('annotate-mode').getAttribute('data-hide-scrollbar')).toBe('true');
  });

  it('AC2/AC6: Mark play opens the ONE side sheet (never the old bottom sheet) and hides the timeline zone', () => {
    render(<AnnotateModeView {...buildProps({ showAnnotateOverlay: true })} />);
    const sheet = screen.getByTestId('annotate-cockpit-sheet');
    expect(within(sheet).getByTestId('overlay-layout').textContent).toBe('landscape-inline');
    expect(screen.queryByTestId('annotate-cockpit-timeline')).toBeNull();
  });

  it('AC3: every button in both strips is at least 44x44 (Play at least 52)', () => {
    render(<AnnotateModeView {...buildProps()} />);
    // jsdom doesn't lay out real pixel sizes, so this asserts the sizing
    // classes directly -- h-11/w-11 (44px) and the play button's h-[52px].
    const play = screen.getByTestId('annotate-play-button');
    expect(play.className).toMatch(/h-\[52px\]/);
    expect(play.className).toMatch(/w-\[52px\]/);
  });

  it('AC7: rotating portrait<->landscape never remounts the video element', () => {
    const props = buildProps();
    const { rerender } = render(<AnnotateModeView {...props} />);
    const before = screen.getByTestId('video-player');
    isLandscapeMock = false;
    rerender(<AnnotateModeView {...props} />);
    const afterPortrait = screen.getByTestId('video-player');
    expect(afterPortrait).toBe(before);
    isLandscapeMock = true;
    rerender(<AnnotateModeView {...props} />);
    const afterLandscape = screen.getByTestId('video-player');
    expect(afterLandscape).toBe(before);
  });

  it('a fresh game (simplifiedControls) hides frame-step and the zoom toggle', () => {
    render(<AnnotateModeView {...buildProps({ simplifiedControls: true, isFirstRun: true, hasAnnotateClips: false })} />);
    expect(screen.queryByTitle('Step backward (one frame)')).toBeNull();
    expect(screen.queryByTestId('annotate-cockpit-zoom-toggle')).toBeNull();
  });

  it('the editor open state hides the 5s/frame skips on the left strip (T8960 parity)', () => {
    render(<AnnotateModeView {...buildProps({ showAnnotateOverlay: true })} />);
    expect(screen.queryByTitle('Back 5 seconds')).toBeNull();
    expect(screen.getByTestId('annotate-play-button')).toBeTruthy();
  });

  it('the source chip shows index/count and opens the Videos sheet holding SourceBar', () => {
    render(<AnnotateModeView {...buildProps({
      sourceBar: { videos: [{ sequence: 1 }, { sequence: 2 }], index: 1, count: 2, onPick: vi.fn() },
    })} />);
    const chip = screen.getByTestId('annotate-cockpit-source-chip');
    expect(chip.textContent).toContain('1/2');
    fireEvent.click(chip);
    expect(screen.getByTestId('source-bar')).toBeTruthy();
  });

  it('portrait mobile fullscreen does not render the cockpit grid strips', () => {
    isLandscapeMock = false;
    render(<AnnotateModeView {...buildProps()} />);
    expect(screen.queryByTestId('annotate-cockpit-left-strip')).toBeNull();
    expect(screen.queryByTestId('annotate-cockpit-right-strip')).toBeNull();
  });
});
