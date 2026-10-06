import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

/**
 * T9620 (UX-10) + T11570: the spotlight editor leads with PICKING A PLAYER.
 * - The guided-pick walk's own guide (SpotlightPickGuide) states the step on
 *   screen (not a hover tooltip) while unpicked markers remain.
 * - The spotlight scaffolding ellipse is suppressed until a player is assigned
 *   (HighlightOverlay does not render), so nothing floats on unassigned ground.
 * - Both are lifted once a detection frame carries an assignment keyframe.
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
vi.mock('../hooks/useIsMobile', () => ({
  useIsMobile: () => false,
  useIsLandscape: () => false,
  useIsPhonePortrait: () => false,
  useIsSmallPhoneViewport: () => false,
}));

import { OverlayModeView } from './OverlayModeView';
import { EDITOR_PANELS } from '../config/displayNames';

const BOX = { x: 100, y: 100, width: 50, height: 100 };
const DETECTION = { timestamp: 0, frame: 0, boxes: [BOX] };

function regionUnassigned() {
  return {
    id: 'r1',
    startTime: 0,
    endTime: 2,
    enabled: true,
    keyframes: [],
    detections: [DETECTION],
    videoWidth: 1920,
    videoHeight: 1080,
    fps: 30,
  };
}

function regionAssigned() {
  return {
    ...regionUnassigned(),
    // A user (fromDetection) keyframe at the detection's frame counts as assigned.
    keyframes: [{ frame: 0, origin: 'user', fromDetection: true, x: 100, y: 100, radiusX: 30, radiusY: 60 }],
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
    currentHighlightState: { x: 100, y: 100, radiusX: 30, radiusY: 60, opacity: 0.3 },
    highlightBoundaries: [],
    highlightRegionKeyframes: [],
    getTimelineScale: () => 1,
    getRegionsForExport: () => [],
    // Player detection: boxes visible at the current frame.
    playerDetectionEnabled: true,
    playerDetections: [BOX],
    showPlayerBoxes: true,
    ...overrides,
  };
  return render(<OverlayModeView {...props} />);
}

describe('OverlayModeView player-selection-first (T9620 + T11570 guided walk)', () => {
  it('shows the guide\'s "Click your athlete" step and suppresses the spotlight before selection', () => {
    renderView({
      highlightRegions: [regionUnassigned()],
      pickGuidePhase: 'parked',
      pickGuideStep: 1,
      pickGuideTotal: 1,
    });
    const guide = screen.getByTestId('spotlight-pick-guide');
    expect(guide.getAttribute('data-phase')).toBe('parked');
    expect(screen.getByTestId('pick-guide-text').textContent).toBe(EDITOR_PANELS.PICK_GUIDE_CLICK);
    expect(screen.getByTestId('pick-guide-step').textContent).toBe(
      EDITOR_PANELS.PICK_GUIDE_STEP(1, 1, false)
    );
    // No ellipse on unassigned ground: HighlightOverlay must not mount.
    expect(screen.queryByTestId('highlight-overlay')).toBeNull();
    // Styling controls hidden; the panel shows the pick-your-athlete guidance.
    expect(screen.getByText(EDITOR_PANELS.SELECT_PLAYER_TITLE)).toBeTruthy();
    expect(screen.queryByText(EDITOR_PANELS.OUTLINE_THICKNESS)).toBeNull();
  });

  it('renders nothing when the guided walk reports no active phase', () => {
    renderView({ highlightRegions: [regionUnassigned()], pickGuidePhase: null });
    expect(screen.queryByTestId('spotlight-pick-guide')).toBeNull();
  });

  it('reveals the spotlight and styling once a player is assigned', () => {
    renderView({
      highlightRegions: [regionAssigned()],
      pickGuidePhase: 'done',
      pickGuideStep: null,
      pickGuideTotal: 1,
    });
    expect(screen.getByTestId('highlight-overlay')).toBeTruthy();
    expect(screen.getByText(EDITOR_PANELS.OUTLINE_THICKNESS)).toBeTruthy();
    // Done state: "All 1 done" + a "Play spotlight" button, no "Step" copy.
    expect(screen.getByTestId('pick-guide-text').textContent).toBe(EDITOR_PANELS.PICK_GUIDE_DONE(1, false));
  });

  it('does not render the guide when tracking is hidden and no guide phase is supplied', () => {
    renderView({ highlightRegions: [regionUnassigned()], showPlayerBoxes: false, pickGuidePhase: null });
    expect(screen.queryByTestId('spotlight-pick-guide')).toBeNull();
  });
});
