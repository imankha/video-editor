import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

/**
 * 2026-09-18 (user request) — supersedes T5641's "hiding the straighten tool
 * does not clear the rotation": toggling Straighten OFF now also resets the
 * angle to 0 (the video returns to its original orientation). Toggling it ON
 * (or on mount) must never touch the angle. Safe now that rotation changes
 * never rewrite stored crop keyframes (the same-day T5640 data-loss fix) --
 * resetting to 0 on toggle-off is a plain angle change like any other.
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
    keyframes: [{ frame: 10, x: 0, y: 0, width: 410, height: 730, origin: 'user' }],
    clipsWithCurrentState: [],
    getTimelineScale: () => 1,
    getSegmentExportData: () => ({}),
    getFilteredKeyframesForExport: () => [],
    onSetRotation: vi.fn(),
    ...overrides,
  };
  return render(<FocusModeView {...props} />);
}

function straightenToggle() {
  return screen.getByTitle(/straighten: level tilted footage/i);
}

describe('FocusModeView straighten Off resets rotation (2026-09-18 user request)', () => {
  it('calls onSetRotation(0) when Straighten is toggled from On to Off', () => {
    const onSetRotation = vi.fn();
    renderView({ onSetRotation });

    const toggle = straightenToggle();
    expect(toggle.getAttribute('aria-pressed')).toBe('false');

    // On: never touches rotation.
    fireEvent.click(toggle);
    expect(straightenToggle().getAttribute('aria-pressed')).toBe('true');
    expect(onSetRotation).not.toHaveBeenCalled();

    // Off: resets to 0.
    fireEvent.click(straightenToggle());
    expect(straightenToggle().getAttribute('aria-pressed')).toBe('false');
    expect(onSetRotation).toHaveBeenCalledTimes(1);
    expect(onSetRotation).toHaveBeenCalledWith(0);
  });

  it('never calls onSetRotation on mount (view-state init only)', () => {
    const onSetRotation = vi.fn();
    renderView({ onSetRotation });
    expect(onSetRotation).not.toHaveBeenCalled();
  });
});
