import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * T11700: a "Set focus point" button on every layout (desktop/tablet
 * FramingActionRow + portrait phone under the stage). It commits a focus point
 * using the crop box exactly where it is now, through the SAME onCropComplete
 * write path a drag uses. No second write path, no mount-time write.
 */

vi.mock('../components/AspectRatioSelector', () => ({ default: () => <div /> }));
vi.mock('../components/VideoPlayer', () => ({ VideoPlayer: () => <div /> }));
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
vi.mock('../components/shared/clipConstants', () => ({ formatTimeSimple: () => '0:00' }));
vi.mock('./focus', () => ({ FocusMode: () => <div />, CropOverlay: () => <div /> }));
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

describe('FocusModeView — Set focus point button (T11700)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('with 0 focus points shows "Set focus point" and commits the current crop via onCropComplete', () => {
    const onCropComplete = vi.fn();
    renderView({ onCropComplete });

    const buttons = screen.getAllByTestId('set-focus-point-button');
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons[0].textContent).toMatch(/set focus point/i);

    fireEvent.click(buttons[0]);

    expect(onCropComplete).toHaveBeenCalledTimes(1);
    expect(onCropComplete).toHaveBeenCalledWith({
      x: CROP.x, y: CROP.y, width: CROP.width, height: CROP.height,
    });
  });

  it('labels the button "Add focus point" once at least one focus point exists', () => {
    renderView({
      keyframes: [{ frame: 60, x: 0, y: 0, width: 540, height: 960, origin: 'user' }],
    });
    const buttons = screen.getAllByTestId('set-focus-point-button');
    expect(buttons[0].textContent).toMatch(/add focus point/i);
    expect(buttons[0].textContent).not.toMatch(/set focus point/i);
  });

  it('shows a transient "Focus point set at" confirmation that clears after 2.5s', () => {
    renderView({ onCropComplete: vi.fn() });
    fireEvent.click(screen.getAllByTestId('set-focus-point-button')[0]);

    expect(screen.getAllByTestId('focus-point-set-confirm')[0].textContent).toMatch(
      /focus point set at 0:02/i
    );

    act(() => vi.advanceTimersByTime(2500));
    expect(screen.queryByTestId('focus-point-set-confirm')).toBeNull();
  });

  it('does not render the button while previewing (previewActive)', () => {
    // 'trim'-origin keyframes do not count as focus points, so the clip is still
    // unframed; the button would show if not for the preview gate.
    renderView({ onCropComplete: vi.fn() });
    expect(screen.getAllByTestId('set-focus-point-button').length).toBeGreaterThan(0);
    // Toggling preview on hides the button.
    const previewBtn = screen.getByTestId('framing-preview-toggle');
    fireEvent.click(previewBtn);
    expect(screen.queryByTestId('set-focus-point-button')).toBeNull();
  });

  it('writes nothing on mount (no focus point created until the button is tapped)', () => {
    const onCropComplete = vi.fn();
    renderView({ onCropComplete });
    expect(onCropComplete).not.toHaveBeenCalled();
  });
});
