import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

/**
 * T11980 (a): during the guided walk, while the current moment is unpicked
 * ('parked' or 'away'), a tap inside the spotlight circle must MOVE the
 * spotlight to the tapped point and count as the pick -- not silently toggle
 * the hidden manual-override edit mode (circleEditActive), which wrote no
 * keyframe and left the walk stuck (repeated taps just flickered edit mode
 * on/off with nothing visible happening).
 *
 * Drives the REAL HighlightOverlay (only its video<->screen transform is
 * mocked to unit scale, same precedent as HighlightOverlay.override.test.jsx)
 * through the real OverlayModeView.handleCircleTap, so this proves the actual
 * wiring -- not just the isolated tap-vs-drag logic HighlightOverlay already
 * has its own tests for.
 */

vi.mock('../hooks/useVideoDisplayRect', () => {
  const round3 = (v) => Math.round(v * 1000) / 1000;
  return {
    __esModule: true,
    round3,
    default: () => ({
      rect: {
        offsetX: 0, offsetY: 0, width: 640, height: 360,
        scaleX: 1, scaleY: 1, zoom: 1, panOffset: { x: 0, y: 0 },
      },
      videoToScreen: (x, y, w, h) => ({ x, y, width: w, height: h }),
      screenToVideo: (x, y, w, h) => ({ x, y, width: w, height: h }),
    }),
  };
});

vi.mock('../components/VideoPlayer', () => ({
  // Render the overlays prop so the REAL HighlightOverlay actually mounts.
  VideoPlayer: ({ overlays }) => <div data-testid="video-player">{overlays}</div>,
}));
vi.mock('../components/Controls', () => ({ Controls: () => <div /> }));
vi.mock('../components/ZoomControls', () => ({ default: () => <div /> }));
vi.mock('../components/ExportButtonView', () => ({
  default: () => <div data-testid="overlay-export-button">Export</div>,
}));
vi.mock('../containers/ExportButtonContainer', () => ({
  ExportButtonContainer: () => ({}),
  HIGHLIGHT_EFFECT_LABELS: {},
  EXPORT_CONFIG: {},
}));
vi.mock('../components/shared', () => ({ Button: ({ children }) => <button>{children}</button> }));
vi.mock('../components/shared/clipConstants', () => ({ DEFAULT_CLIP_BEFORE: 6, DEFAULT_CLIP_AFTER: 2, formatTimeSimple: () => '0:00' }));
vi.mock('./overlay', async () => {
  const actual = await vi.importActual('./overlay');
  return {
    ...actual,
    // Keep the REAL HighlightOverlay (actual.HighlightOverlay); stub the rest.
    OverlayMode: () => <div data-testid="overlay-timeline" />,
    PlayerDetectionOverlay: () => <div data-testid="player-detection-overlay" />,
    TextOverlayPreview: () => <div />,
  };
});
vi.mock('../hooks/useFullscreenControls', () => ({
  useFullscreenControls: () => ({
    isVisible: true,
    handleInteraction: () => {},
    handleLongPressTouchStart: () => {},
    handleLongPressTouchMove: () => {},
    handleLongPressTouchEnd: () => {},
  }),
}));
vi.mock('../hooks/useIsMobile', () => ({
  useIsMobile: () => false,
  useIsLandscape: () => false,
  useIsPhonePortrait: () => false,
  useIsSmallPhoneViewport: () => false,
  useIsCoarsePointer: () => false,
}));

import { OverlayModeView } from './OverlayModeView';

const CURRENT_HIGHLIGHT = {
  x: 300, y: 150, radiusX: 40, radiusY: 60, opacity: 0.3, color: '#FFFFFF',
};

function region() {
  return {
    id: 'r1', startTime: 0, endTime: 2, enabled: true, keyframes: [],
    // No detections -- currentRegionAwaitsPick stays false so the circle
    // renders regardless of the guide's own (independently-supplied) phase.
    detections: [], videoWidth: 1920, videoHeight: 1080, fps: 30,
  };
}

function renderView(overrides = {}) {
  const props = {
    videoRef: { current: null },
    effectiveOverlayVideoUrl: 'blob:overlay',
    effectiveOverlayMetadata: { width: 1920, height: 1080, framerate: 30, duration: 10 },
    isFullscreen: false,
    handlers: {},
    currentTime: 0,
    isTimeInEnabledRegion: () => true,
    currentHighlightState: CURRENT_HIGHLIGHT,
    onHighlightChange: vi.fn(),
    onHighlightComplete: vi.fn(),
    highlightRegions: [region()],
    highlightBoundaries: [],
    highlightRegionKeyframes: [],
    getTimelineScale: () => 1,
    getRegionsForExport: () => [],
    playerDetectionEnabled: false,
    playerDetections: [],
    showPlayerBoxes: true,
    ...overrides,
  };
  return render(<OverlayModeView {...props} />);
}

/** Fire a stationary tap on an element (down + up, no move) -> counts as a TAP. */
function tap(el, pointerId = 1, x = 300, y = 150) {
  fireEvent.pointerDown(el, { pointerId, pointerType: 'touch', clientX: x, clientY: y });
  fireEvent.pointerUp(el, { pointerId, pointerType: 'touch', clientX: x, clientY: y });
}

describe('OverlayModeView circle tap during the guided walk (T11980)', () => {
  it.each(['parked', 'away'])(
    'while the walk is %s (current moment unpicked), a tap inside the circle picks instead of toggling edit mode',
    (pickGuidePhase) => {
      const onHighlightComplete = vi.fn();
      renderView({ pickGuidePhase, pickGuideStep: 1, pickGuideTotal: 1, onHighlightComplete });

      const enterHit = screen.getByTestId('highlight-enter-hit');
      tap(enterHit, 1, 350, 220);

      expect(onHighlightComplete).toHaveBeenCalledTimes(1);
      expect(onHighlightComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          x: 350, y: 220, radiusX: CURRENT_HIGHLIGHT.radiusX, radiusY: CURRENT_HIGHLIGHT.radiusY,
          color: CURRENT_HIGHLIGHT.color,
        })
      );
      // No manual-override edit mode entered -- the tap counted as a pick.
      expect(screen.queryByTestId('highlight-corner-nw')).toBeNull();
    }
  );

  it('once every marker is picked ("done"), a tap inside the circle still toggles manual-override edit (unchanged behavior)', () => {
    const onHighlightComplete = vi.fn();
    renderView({ pickGuidePhase: 'done', pickGuideStep: null, pickGuideTotal: 1, onHighlightComplete });

    const enterHit = screen.getByTestId('highlight-enter-hit');
    tap(enterHit, 1, 350, 220);

    expect(onHighlightComplete).not.toHaveBeenCalled();
    // Toggled into manual-override edit mode -- corner handles now render.
    expect(screen.getByTestId('highlight-corner-nw')).toBeTruthy();
  });
});
