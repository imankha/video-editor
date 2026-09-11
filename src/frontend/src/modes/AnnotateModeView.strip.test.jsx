import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

/**
 * T8600 — desktop under-canvas editor strip.
 *
 * When the add/edit editor is open on desktop non-fullscreen, the strip
 * (AnnotateFullscreenOverlay layout="strip") replaces the timeline and the
 * CTA/Playback/Share block. It must receive existingClip (T8590 invariant,
 * re-homed here now that the sidebar render is gone) and a surface tag for
 * the beacon discriminator.
 */

vi.mock('../components/VideoPlayer', () => ({
  VideoPlayer: () => <div data-testid="video-player" />,
}));
vi.mock('../components/shared/VideoLoadingOverlay', () => ({
  VideoLoadingOverlay: () => <div />,
}));
vi.mock('../components/ZoomControls', () => ({ default: () => <div /> }));
vi.mock('./annotate', () => ({
  AnnotateMode: () => <div data-testid="timeline" />,
  AnnotateControls: (props) => (
    <div data-testid="controls" data-add-clip={props.onAddClip ? 'present' : 'absent'} />
  ),
  NotesOverlay: () => <div />,
  AnnotateFullscreenOverlay: (props) => (
    <div
      data-testid={props.layout === 'strip' ? 'strip' : 'overlay'}
      data-layout={props.layout}
      data-surface={props.surface}
    >
      {props.existingClip ? `existingClip:${props.existingClip.id}` : 'existingClip:null'}
    </div>
  ),
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

const clipRegions = [
  { id: 'c1', startTime: 10, endTime: 20, videoSequence: 1, my_athlete: true, name: 'Great Pass', rating: 5 },
];

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
}

function renderView(overrides = {}) {
  return render(<AnnotateModeView {...buildProps(overrides)} />);
}

describe('AnnotateModeView — desktop under-canvas editor strip (T8600)', () => {
  it('renders no strip and the normal timeline + CTA when the editor is closed', () => {
    renderView({ showAnnotateOverlay: false });
    expect(screen.queryByTestId('strip')).toBeNull();
    expect(screen.getByTestId('timeline')).toBeTruthy();
    expect(screen.getByTestId('annotate-primary-cta')).toBeTruthy();
  });

  it('CREATING: strip replaces the timeline and CTA, existingClip is null', () => {
    renderView({ showAnnotateOverlay: true, annotateSelectedRegionId: null });
    const strip = screen.getByTestId('strip');
    expect(strip.dataset.layout).toBe('strip');
    expect(strip.textContent).toBe('existingClip:null');
    expect(screen.queryByTestId('timeline')).toBeNull();
    expect(screen.queryByTestId('annotate-primary-cta')).toBeNull();
  });

  it('EDITING: strip passes the selected clip as existingClip (T8590 invariant)', () => {
    renderView({ showAnnotateOverlay: true, annotateSelectedRegionId: 'c1', isEditMode: true });
    const strip = screen.getByTestId('strip');
    expect(strip.textContent).toBe('existingClip:c1');
  });

  it('passes a surface tag for the beacon discriminator', () => {
    renderView({ showAnnotateOverlay: true });
    expect(screen.getByTestId('strip').dataset.surface).toBe('inline_desktop');
  });

  // T9500: desktop fullscreen now uses the SAME bottom-center strip as normal
  // mode (parity), not the old side dock. The dock render site is gone.
  it('renders the shared strip in desktop fullscreen (T9500 parity, was the old dock)', () => {
    renderView({ showAnnotateOverlay: true, annotateFullscreen: true });
    const strip = screen.getByTestId('strip');
    expect(strip.dataset.layout).toBe('strip');
    expect(strip.dataset.surface).toBe('inline_desktop');
    expect(screen.queryByTestId('overlay')).toBeNull();
  });

  // T9500: because the strip is ONE element at ONE JSX position for both
  // fullscreen and windowed desktop, toggling fullscreen preserves the fiber
  // (same DOM node) — that is the mechanism by which an unsaved note + selected
  // times survive entering/exiting fullscreen. A remount would return a new node.
  it('keeps the SAME strip DOM node across the fullscreen toggle (draft survives)', () => {
    const { rerender } = render(
      <AnnotateModeView {...buildProps({ showAnnotateOverlay: true, annotateSelectedRegionId: null })} />,
    );
    const before = screen.getByTestId('strip');
    rerender(
      <AnnotateModeView {...buildProps({ showAnnotateOverlay: true, annotateSelectedRegionId: null, annotateFullscreen: true })} />,
    );
    const after = screen.getByTestId('strip');
    expect(after).toBe(before);
  });

  it('suppresses the transport-bar Add button while the strip is open', () => {
    renderView({ showAnnotateOverlay: true });
    expect(screen.getByTestId('controls').dataset.addClip).toBe('absent');
  });

  it('restores the transport-bar Add button once the editor closes', () => {
    renderView({ showAnnotateOverlay: false });
    expect(screen.getByTestId('controls').dataset.addClip).toBe('present');
  });
});
