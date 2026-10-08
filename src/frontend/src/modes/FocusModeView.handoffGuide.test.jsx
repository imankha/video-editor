import { act, render, screen, fireEvent } from '@testing-library/react';
import { useSettingsStore } from '../stores/settingsStore';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Guided framing steps: ONE instruction at a time (drag the box -> play -> keep the
 * box on your player). Preview highlight, Trim and SlowMo, and Generate are all
 * locked until the first two steps are done. Pressing Trim and SlowMo swaps the
 * guide to trim instructions.
 */

const exportContainerSpy = vi.fn(() => ({}));

vi.mock('../components/AspectRatioSelector', () => ({ default: () => <div /> }));
vi.mock('../components/VideoPlayer', () => ({
  VideoPlayer: ({ overlays }) => <div>{overlays}</div>,
}));
vi.mock('../components/Controls', () => ({
  Controls: ({ onTogglePlay, pulsePlay }) => (
    <button data-testid="play" data-pulse={String(!!pulsePlay)} onClick={onTogglePlay} />
  ),
}));
vi.mock('../components/ZoomControls', () => ({ default: () => <div /> }));
vi.mock('../components/ExportButtonView', () => ({ default: ({ actionsAbove, pulseGenerate }) => <div><button data-testid="generate" data-pulse={String(!!pulseGenerate)} />{actionsAbove}</div> }));
vi.mock('../containers/ExportButtonContainer', () => ({
  ExportButtonContainer: (args) => exportContainerSpy(args),
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
vi.mock('./focus', () => ({
  FocusMode: () => <div />,
  CropOverlay: ({ guidePulse, onCropComplete }) => (
    <button
      data-testid="crop-box"
      data-pulse={String(!!guidePulse)}
      onClick={() => onCropComplete({ x: 0, y: 0, width: 10, height: 10 })}
    />
  ),
}));
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

const kf = (frame, origin = 'user') => ({ frame, x: 0, y: 0, width: 100, height: 100, origin });

function baseProps() {
  return {
    videoRef: { current: null },
    videoUrl: 'blob:video',
    metadata: { width: 1920, height: 1080, framerate: 30 },
    currentCropState: { x: 0, y: 0, width: 100, height: 100 },
    isFullscreen: false,
    handlers: {},
    aspectRatio: '9:16',
    globalAspectRatio: '9:16',
    onAspectRatioChange: vi.fn(),
    onCropComplete: vi.fn(),
    togglePlay: vi.fn(),
    isPlaying: false,
    keyframes: [],
    segmentBoundaries: [0, 10],
    clipsWithCurrentState: [],
    getTimelineScale: () => 1,
    getSegmentExportData: () => ({}),
    getFilteredKeyframesForExport: () => [],
  };
}

function Harness({ initial = {} }) {
  return <FocusModeView {...baseProps()} {...initial} />;
}

function lastDisabled() {
  const calls = exportContainerSpy.mock.calls;
  return calls[calls.length - 1][0].disabled;
}

function unlocked() {
  const view = render(<Harness initial={{ keyframes: [kf(10)] }} />);
  view.rerender(<Harness initial={{ keyframes: [kf(10)], isPlaying: true }} />);
  return view;
}

describe('FocusModeView step-5 guide while the finished render opens (T11970)', () => {
  beforeEach(() => exportContainerSpy.mockClear());

  it('hides the Generate guide once framingCtaMode is "opening"', () => {
    const props = { keyframes: [kf(10)], isPlaying: true, clipDuration: 6, currentTime: 5.9 };
    const { rerender } = unlocked();
    rerender(<Harness initial={props} />);
    fireEvent.click(screen.getByTestId('framing-preview-toggle'));
    rerender(<Harness initial={{ ...props, currentTime: 0 }} />);
    rerender(<Harness initial={props} />);
    expect(screen.getByTestId('framing-guide-step').textContent).toBe('Step 5 of 5');

    rerender(<Harness initial={{ ...props, framingCtaMode: 'opening' }} />);
    expect(screen.queryByTestId('framing-guide-step')).toBeNull();
  });
});
