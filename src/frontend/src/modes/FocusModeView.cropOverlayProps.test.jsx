import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

/**
 * T11710/T11700 regression guard for the PORTRAIT render path — the twin of
 * FocusCockpit.test.jsx's props-capture test. FocusModeView must pass the REAL
 * coach/drag props into <CropOverlay> (focusPointCount, isPlaying, isDragging,
 * onDragStateChange). CropOverlay has NO defaults for these (no-silent-fallback),
 * so a dropped prop would silently break showCoach / the drag disable. Before this
 * test, removing all four from FocusModeView's CropOverlay call left every src/modes
 * test green — nothing guarded the portrait path.
 *
 * The test fails if ANY of the four props is removed:
 *   - focusPointCount missing -> undefined !== 2
 *   - isPlaying missing       -> undefined !== true
 *   - isDragging missing      -> undefined !== false
 *   - onDragStateChange missing -> not a function (and the drag-disable call throws)
 */

// Render the overlays the portrait path passes in (the real VideoPlayer does), so
// the capturing CropOverlay stub actually mounts.
vi.mock('../components/VideoPlayer', () => ({
  VideoPlayer: ({ overlays }) => <div data-testid="mock-videoplayer">{overlays}</div>,
}));

// Capture the props FocusModeView passes into CropOverlay.
const cropOverlayCapture = vi.hoisted(() => ({ last: null }));
vi.mock('./focus', () => ({
  FocusMode: () => <div />,
  CropOverlay: (props) => {
    cropOverlayCapture.last = props;
    return <div data-testid="mock-cropoverlay" />;
  },
}));

vi.mock('../components/AspectRatioSelector', () => ({ default: () => <div /> }));
vi.mock('../components/Controls', () => ({ Controls: () => <div /> }));
vi.mock('../components/ZoomControls', () => ({ default: () => <div /> }));
vi.mock('../components/ExportButtonView', () => ({ default: () => <div /> }));
vi.mock('../containers/ExportButtonContainer', () => ({
  ExportButtonContainer: () => ({}),
  HIGHLIGHT_EFFECT_LABELS: {},
  EXPORT_CONFIG: {},
}));
vi.mock('../components/shared', () => ({
  Button: ({ children }) => <button>{children}</button>,
  Toggle: ({ checked, onChange }) => (
    <button role="switch" aria-checked={checked} onClick={() => onChange?.(!checked)} />
  ),
}));
vi.mock('../components/shared/clipConstants', () => ({ DEFAULT_CLIP_BEFORE: 6, DEFAULT_CLIP_AFTER: 2, formatTimeSimple: () => '0:00' }));
vi.mock('../hooks/useIsMobile', () => ({ useIsMobile: () => false }));
vi.mock('../hooks/useFullscreenControls', () => ({
  useFullscreenControls: () => ({
    isVisible: true,
    handleInteraction: () => {},
    handleLongPressTouchStart: () => {},
    handleLongPressTouchMove: () => {},
    handleLongPressTouchEnd: () => {},
  }),
}));

import { FocusModeView } from './FocusModeView';

const CROP = { x: 100, y: 50, width: 540, height: 960 };

function renderView(overrides = {}) {
  const props = {
    videoRef: { current: null },
    videoUrl: 'blob:video',
    metadata: { width: 1920, height: 1080, framerate: 30 },
    isFullscreen: false,
    handlers: {},
    aspectRatio: '9:16',
    globalAspectRatio: '9:16',
    onAspectRatioChange: vi.fn(),
    currentCropState: CROP,
    currentTime: 2,
    keyframes: [],
    clipsWithCurrentState: [],
    getTimelineScale: () => 1,
    getSegmentExportData: () => ({}),
    getFilteredKeyframesForExport: () => [],
    ...overrides,
  };
  return render(<FocusModeView {...props} />);
}

describe('FocusModeView — CropOverlay coach/drag props (portrait path, T11710/T11700)', () => {
  it('passes the real focusPointCount (trim-origin excluded) and isPlaying', () => {
    cropOverlayCapture.last = null;
    renderView({
      keyframes: [
        { frame: 30, origin: 'user' },
        { frame: 0, origin: 'trim' },   // trim keyframes are NOT focus points
        { frame: 90, origin: 'user' },
      ],
      isPlaying: true,
    });
    expect(cropOverlayCapture.last).toBeTruthy();
    expect(cropOverlayCapture.last.focusPointCount).toBe(2);
    expect(cropOverlayCapture.last.isPlaying).toBe(true);
  });

  it('wires isDragging + onDragStateChange, and a drag flips isDragging AND disables the Set focus point button', () => {
    cropOverlayCapture.last = null;
    renderView({ keyframes: [], isPlaying: false });

    expect(cropOverlayCapture.last).toBeTruthy();
    expect(typeof cropOverlayCapture.last.onDragStateChange, 'CropOverlay gets a drag-state setter').toBe('function');
    expect(cropOverlayCapture.last.isDragging, 'isDragging starts false, not undefined').toBe(false);

    // Both Set-focus-point placements (under-stage + FramingActionRow) render in
    // jsdom (CSS breakpoints don't apply); neither is disabled before a drag.
    const buttonsBefore = screen.getAllByTestId('set-focus-point-button');
    expect(buttonsBefore.length).toBeGreaterThan(0);
    buttonsBefore.forEach((b) => expect(b.disabled, 'not disabled before a drag').toBe(false));

    // A drag-start from CropOverlay must flip isDragging through to CropOverlay AND
    // disable the Set focus point button (landmine: currentCropState is a live,
    // mid-drag value while dragging, so committing it would be wrong).
    act(() => { cropOverlayCapture.last.onDragStateChange(true); });

    expect(cropOverlayCapture.last.isDragging, 'drag-start flips isDragging true').toBe(true);
    screen.getAllByTestId('set-focus-point-button').forEach((b) =>
      expect(b.disabled, 'Set focus point disabled while dragging').toBe(true));
  });
});
