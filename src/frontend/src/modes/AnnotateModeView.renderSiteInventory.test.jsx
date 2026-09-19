import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

/**
 * T10610 § E row 6 (replaces the retired .beaconSurfaces.test.jsx, whose
 * `add_clip_opened_no_save` beacon + `surface` discriminator are both gone) —
 * render-site inventory. Every AnnotateFullscreenOverlay render site must
 * pass `existingClip` (T8590 invariant) AND, since T10610, `onDeleteClip` +
 * `onAwaitWrites` (every layout needs Delete play and the Frame-ordering
 * await) — a render site that forgets any of these silently regresses with
 * no error.
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
    <div
      data-testid="overlay-render"
      data-layout={props.layout}
      data-has-delete={props.onDeleteClip ? 'present' : 'absent'}
      data-has-await={props.onAwaitWrites ? 'present' : 'absent'}
      data-write-status={props.writeStatus ?? 'absent'}
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
    onDeletePlayFromEditor: vi.fn(),
    onAwaitRegionWrites: vi.fn(() => Promise.resolve(true)),
    writeStatus: 'idle',
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

describe('AnnotateFullscreenOverlay render-site inventory (T10610)', () => {
  // T9500: desktop fullscreen renders the shared strip (layout=strip), not the old dock.
  it('desktop fullscreen: strip layout, existingClip + onDeleteClip + onAwaitWrites present', () => {
    mockIsMobile = false;
    renderView({ annotateFullscreen: true });
    const el = screen.getByTestId('overlay-render');
    expect(el.dataset.layout).toBe('strip');
    expect(el.dataset.hasDelete).toBe('present');
    expect(el.dataset.hasAwait).toBe('present');
    expect(el.textContent).toBe('existingClip:c1');
  });

  it('mobile fullscreen sheet: existingClip + onDeleteClip + onAwaitWrites present', () => {
    mockIsMobile = true;
    renderView({ annotateFullscreen: true });
    const el = screen.getByTestId('overlay-render');
    expect(el.dataset.hasDelete).toBe('present');
    expect(el.dataset.hasAwait).toBe('present');
    expect(el.textContent).toBe('existingClip:c1');
  });

  it('mobile bottom sheet: existingClip + onDeleteClip + onAwaitWrites present', () => {
    mockIsMobile = true;
    renderView({ annotateFullscreen: false });
    const el = screen.getByTestId('overlay-render');
    expect(el.dataset.hasDelete).toBe('present');
    expect(el.dataset.hasAwait).toBe('present');
    expect(el.textContent).toBe('existingClip:c1');
  });

  it('desktop strip (windowed): existingClip + onDeleteClip + onAwaitWrites present', () => {
    mockIsMobile = false;
    renderView({ annotateFullscreen: false });
    const el = screen.getByTestId('overlay-render');
    expect(el.dataset.hasDelete).toBe('present');
    expect(el.dataset.hasAwait).toBe('present');
    expect(el.textContent).toBe('existingClip:c1');
  });

  it('threads writeStatus through to the editor on every render site', () => {
    mockIsMobile = false;
    renderView({ annotateFullscreen: false, writeStatus: 'saving' });
    expect(screen.getByTestId('overlay-render').dataset.writeStatus).toBe('saving');
  });
});
