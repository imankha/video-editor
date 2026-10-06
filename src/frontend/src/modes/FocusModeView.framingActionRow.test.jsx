import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

/**
 * T9950 Slice 2: FocusModeView threads Undo state/handlers to FramingActionRow,
 * rendered under the timeline (above the Advanced editing disclosure, design
 * doc §5). T10310 (2026-09-18 user request): the wider-frame wiring this file
 * used to also cover was removed along with the button itself.
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
vi.mock('../components/shared/clipConstants', () => ({ DEFAULT_CLIP_BEFORE: 6, DEFAULT_CLIP_AFTER: 2, formatTimeSimple: () => '0:00' }));
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
  it('does not render the retired Undo control', () => {
    renderView({ canUndoFraming: true, onUndoFraming: vi.fn() });
    expect(screen.queryByTestId('framing-undo')).toBeNull();
  });

  it('never renders a widen-frame control', () => {
    renderView();
    expect(screen.queryByTestId('framing-widen')).toBeNull();
  });

  it('does not render the action row without a video', () => {
    renderView({ videoUrl: '' });
    expect(screen.queryByTestId('framing-undo')).toBeNull();
  });

  it('starts Preview highlight at clip-relative zero without overwriting the translated media time', () => {
    const seek = vi.fn();
    const play = vi.fn(() => Promise.resolve());
    const videoRef = { current: { currentTime: 561.9, play, closest: () => null } };
    renderView({ seek, videoRef });
    const previewBtn = screen.getByTestId('framing-preview-toggle');
    expect(previewBtn.textContent).toMatch(/preview highlight/i);
    expect(screen.queryByTestId('preview-disclosure')).toBeNull();

    fireEvent.click(previewBtn);

    expect(seek).toHaveBeenCalledWith(0);
    // useVideo.seek translates clip-relative zero to the underlying source
    // boundary. The click handler must not replace it with absolute media zero.
    expect(videoRef.current.currentTime).toBe(561.9);
    expect(play).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('framing-preview-toggle').textContent).toMatch(/back to framing/i);
    expect(screen.getByTestId('preview-disclosure')).not.toBeNull();
  });
});
