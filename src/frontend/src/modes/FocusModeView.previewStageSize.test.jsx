import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

/**
 * T10310 (2026-09-18 user request): "Preview highlight" was growing taller than
 * the viewport on a portrait (9:16) reel -- the stage box's `aspectRatio` style
 * derived height FROM the editor column's full width with no cap, so a wide
 * desktop column produced a very tall box. Fix: `lg:h-[70vh] lg:max-h-[70vh]` +
 * `lg:w-fit` caps the height and derives width instead, matching
 * OverlayModeView's stageBoxStyle for the identical portrait-preview case.
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

describe('FocusModeView preview-highlight stage sizing (T10310)', () => {
  it('is not height-capped before Preview highlight is toggled on', () => {
    renderView();
    const stage = screen.getByTestId('focus-video-stage');
    expect(stage.className).not.toMatch(/lg:h-\[70vh\]/);
  });

  it('caps height (and derives width) once Preview highlight is on, for a portrait reel', () => {
    renderView({ globalAspectRatio: '9:16' });
    fireEvent.click(screen.getByTestId('framing-preview-toggle'));

    const stage = screen.getByTestId('focus-video-stage');
    expect(stage.className).toMatch(/lg:h-\[70vh\]/);
    expect(stage.className).toMatch(/lg:max-h-\[70vh\]/);
    expect(stage.className).toMatch(/lg:w-fit/);
    expect(stage.style.aspectRatio).toBe('9 / 16');
  });

  it('drops the height cap again once Preview highlight is toggled back off', () => {
    renderView();
    const toggle = screen.getByTestId('framing-preview-toggle');
    fireEvent.click(toggle); // on
    fireEvent.click(toggle); // off

    const stage = screen.getByTestId('focus-video-stage');
    expect(stage.className).not.toMatch(/lg:h-\[70vh\]/);
    expect(stage.style.aspectRatio).toBeFalsy();
  });
});
