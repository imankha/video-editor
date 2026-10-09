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
vi.mock('../components/ExportButtonView', () => ({ default: ({ actionsAbove }) => <div>{actionsAbove}</div> }));
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
    // Preview highlight is locked until the guided steps are done (a user focus point exists above; play is the last step).
    isPlaying: true,
    ...overrides,
  };
  return render(<FocusModeView {...props} />);
}

// jsdom has no layout, so assert the sizing contract: width = min(column,
// 70vh * ratio), height from aspect-ratio. A fixed lg height made landscape
// taller than 16:9 (the stage must match the output aspect at any width).
function expectWidthDerivedStage(stage, aspect, ratio) {
  expect(stage.className).not.toMatch(/lg:h-\[70vh\]/);
  // T12020: the cap also subtracts the sticky bar's height (--cta-bar-h).
  expect(stage.className).toMatch(/lg:w-\[min\(100%,calc\(min\(70vh,100dvh-var\(--cta-bar-h,0px\)-12rem\)\*var\(--preview-ar\)\)\)\]/);
  expect(stage.style.aspectRatio).toBe(aspect);
  expect(Number(stage.style.getPropertyValue('--preview-ar'))).toBeCloseTo(ratio, 4);
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
    expectWidthDerivedStage(stage, '9 / 16', 9 / 16);
  });

  it('sizes a landscape reel to exactly 16:9 instead of a fixed 70vh height', () => {
    renderView({ globalAspectRatio: '16:9' });
    fireEvent.click(screen.getByTestId('framing-preview-toggle'));
    expectWidthDerivedStage(screen.getByTestId('focus-video-stage'), '16 / 9', 16 / 9);
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
