import { render, screen } from '@testing-library/react';
import { beforeEach, describe, it, expect, vi } from 'vitest';

/**
 * T17180: on a phone in portrait the spotlight's "Tap your athlete" walk is a one-line strip in
 * the page flow ABOVE the video stage, so no part of the guide can sit over the athletes. Wider
 * screens and phone fullscreen keep the floating card (which leaves the stage clear by keepClear).
 */

vi.mock('../components/VideoPlayer', () => ({
  // Render the overlays prop so we can assert whether HighlightOverlay mounted.
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
vi.mock('./overlay', () => ({
  OverlayMode: () => <div data-testid="overlay-timeline" />,
  HighlightOverlay: () => <div data-testid="highlight-overlay" />,
  PlayerDetectionOverlay: () => <div data-testid="player-detection-overlay" />,
  TextOverlayPreview: () => <div />,
}));
vi.mock('../hooks/useFullscreenControls', () => ({
  useFullscreenControls: () => ({
    isVisible: true,
    handleInteraction: () => {},
    handleLongPressTouchStart: () => {},
    handleLongPressTouchMove: () => {},
    handleLongPressTouchEnd: () => {},
  }),
}));
const { viewport } = vi.hoisted(() => ({ viewport: { phonePortrait: true } }));
vi.mock('../hooks/useIsMobile', () => ({
  useIsMobile: () => viewport.phonePortrait,
  useIsLandscape: () => false,
  useIsPhonePortrait: () => viewport.phonePortrait,
  useIsSmallPhoneViewport: () => false,
  useIsCoarsePointer: () => viewport.phonePortrait,
}));

import { OverlayModeView } from './OverlayModeView';
import { useSettingsStore } from '../stores/settingsStore';

beforeEach(() => {
  useSettingsStore.getState().setFromBootstrap({ guidance: { coachEnabled: true } });
  viewport.phonePortrait = true;
});

const BOX = { x: 100, y: 100, width: 50, height: 100 };
const region = {
  id: 'r1', startTime: 0, endTime: 2, enabled: true, keyframes: [],
  detections: [{ timestamp: 0, frame: 0, boxes: [BOX] }], videoWidth: 1920, videoHeight: 1080, fps: 30,
};

function renderView(overrides = {}) {
  return render(<OverlayModeView
    videoRef={{ current: null }}
    effectiveOverlayVideoUrl="blob:overlay"
    effectiveOverlayMetadata={{ width: 1920, height: 1080, framerate: 30, duration: 10 }}
    isFullscreen={false}
    handlers={{}}
    currentTime={0}
    isTimeInEnabledRegion={() => true}
    currentHighlightState={{ x: 100, y: 100, radiusX: 30, radiusY: 60, opacity: 0.3 }}
    highlightBoundaries={[]}
    highlightRegionKeyframes={[]}
    getTimelineScale={() => 1}
    getRegionsForExport={() => []}
    playerDetectionEnabled
    playerDetections={[BOX]}
    showPlayerBoxes
    highlightRegions={[region]}
    pickGuidePhase="parked"
    pickGuideStep={1}
    pickGuideTotal={4}
    {...overrides}
  />);
}

describe('OverlayModeView pick strip (T17180)', () => {
  it('on a phone, the tap walk is a strip placed before the video stage, outside it', () => {
    renderView();
    const guide = screen.getByTestId('spotlight-pick-guide');
    const stage = screen.getByTestId('overlay-video-stage');
    expect(guide.dataset.variant).toBe('strip');
    expect(stage.contains(guide)).toBe(false);
    // In the same column, before the stage: it lays out above the video, never over it.
    expect(guide.compareDocumentPosition(stage) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(guide.closest('[data-testid="floating-coach-host"]')).toBeNull();
    expect(screen.getByTestId('pick-guide-text').textContent).toBe('Tap your athlete, 1 of 4');
    expect(screen.getByTestId('pick-guide-not-boxed')).toBeTruthy();
  });

  it('on a wider screen the walk stays the floating card', () => {
    viewport.phonePortrait = false;
    renderView();
    expect(screen.getByTestId('spotlight-pick-guide').dataset.variant).toBeUndefined();
  });
});
