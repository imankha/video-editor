import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

/**
 * T9950 Slice 2: FocusModeView threads the wider-frame + Undo state/handlers
 * to FramingActionRow, rendered under the timeline (above the Advanced editing
 * disclosure, design doc §5).
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
    keyframes: [{ frame: 10, x: 0, y: 0, width: 205, height: 365, origin: 'user' }],
    clipsWithCurrentState: [],
    getTimelineScale: () => 1,
    getSegmentExportData: () => ({}),
    getFilteredKeyframesForExport: () => [],
    ...overrides,
  };
  return render(<FocusModeView {...props} />);
}

describe('FocusModeView FramingActionRow wiring (T9950 Slice 2)', () => {
  it('passes canUndoFraming through to disable/enable the Undo button', () => {
    renderView({ canUndoFraming: false });
    expect(screen.getByTestId('framing-undo').disabled).toBe(true);
  });

  it('calls onUndoFraming when Undo is clicked', () => {
    const onUndoFraming = vi.fn();
    renderView({ canUndoFraming: true, onUndoFraming });
    screen.getByTestId('framing-undo').click();
    expect(onUndoFraming).toHaveBeenCalledTimes(1);
  });

  it('calls onWidenFraming when the widen button is clicked, and reflects isWideFraming', () => {
    const onWidenFraming = vi.fn();
    renderView({ isWideFraming: true, onWidenFraming });
    const widenBtn = screen.getByTestId('framing-widen');
    expect(widenBtn.getAttribute('aria-pressed')).toBe('true');
    widenBtn.click();
    expect(onWidenFraming).toHaveBeenCalledTimes(1);
  });

  it('does not render the action row without a video', () => {
    renderView({ videoUrl: '' });
    expect(screen.queryByTestId('framing-undo')).toBeNull();
  });

  it('toggling Preview highlight flips its label and shows the approximation disclosure (T9950 Slice 3)', () => {
    renderView();
    const previewBtn = screen.getByTestId('framing-preview-toggle');
    expect(previewBtn.textContent).toMatch(/preview highlight/i);
    expect(screen.queryByTestId('preview-disclosure')).toBeNull();

    fireEvent.click(previewBtn);

    expect(screen.getByTestId('framing-preview-toggle').textContent).toMatch(/back to framing/i);
    expect(screen.getByTestId('preview-disclosure')).not.toBeNull();
  });

  it('shows the multi-clip disclosure line only when previewing a multi-clip project', () => {
    renderView({ clipsWithCurrentState: [{ id: 'a' }, { id: 'b' }], hasClips: true });
    fireEvent.click(screen.getByTestId('framing-preview-toggle'));
    expect(screen.getByTestId('preview-disclosure').textContent).toMatch(/your clips are joined at export/i);
  });
});
