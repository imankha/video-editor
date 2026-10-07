import { render, screen, fireEvent } from '@testing-library/react';
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
vi.mock('../components/ExportButtonView', () => ({ default: () => <div /> }));
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

describe('FocusModeView guided framing steps', () => {
  beforeEach(() => exportContainerSpy.mockClear());

  it('step 1: shows only the drag instruction and pulses the box, not play', () => {
    render(<Harness />);
    expect(screen.getByTestId('framing-guide-text').textContent).toBe('Drag your box onto your player.');
    expect(screen.getByTestId('crop-box').dataset.pulse).toBe('true');
    expect(screen.getByTestId('play').dataset.pulse).toBe('false');
    expect(screen.queryByText(/Play the video/)).toBeNull();
  });

  it('removes the old instructions panel and Set/Add focus point buttons', () => {
    render(<Harness />);
    expect(screen.queryByTestId('framing-instructions')).toBeNull();
    expect(screen.queryByTestId('set-focus-point-button')).toBeNull();
    expect(screen.queryByTestId('advanced-editing-disclosure')).toBeNull();
    expect(document.body.textContent).not.toMatch(/Add focus point|Set focus point/);
  });

  it('locks Trim and SlowMo, Preview highlight and Generate until steps 1 and 2 are done', () => {
    render(<Harness />);
    expect(screen.getByRole('button', { name: 'Trim and SlowMo' }).disabled).toBe(true);
    expect(screen.getByTestId('framing-preview-toggle').disabled).toBe(true);
    expect(lastDisabled()).toBe(true);
  });

  it('dragging the box advances to step 2: play pulses, box stops', () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId('crop-box'));
    expect(screen.getByTestId('framing-guide-text').textContent).toBe('Play the video.');
    expect(screen.getByTestId('crop-box').dataset.pulse).toBe('false');
    expect(screen.getByTestId('play').dataset.pulse).toBe('true');
    expect(screen.getByTestId('framing-preview-toggle').disabled).toBe(true);
    expect(lastDisabled()).toBe(true);
  });

  it('pressing play advances to step 3 and unlocks all three buttons together', () => {
    const { rerender } = render(<Harness />);
    fireEvent.click(screen.getByTestId('crop-box'));
    // The screen flips isPlaying once the play gesture lands.
    rerender(<Harness initial={{ isPlaying: true }} />);
    expect(screen.getByTestId('framing-guide-text').textContent).toBe('Keep the box around your player.');
    expect(screen.getByTestId('play').dataset.pulse).toBe('false');
    expect(screen.getByRole('button', { name: 'Trim and SlowMo' }).disabled).toBe(false);
    expect(screen.getByTestId('framing-preview-toggle').disabled).toBe(false);
    expect(lastDisabled()).toBe(false);
  });

  it('a clip that already has a focus point starts at step 2', () => {
    render(<Harness initial={{ keyframes: [kf(10)] }} />);
    expect(screen.getByTestId('framing-guide-text').textContent).toBe('Play the video.');
  });

  it('ignores trim-origin keyframes when deciding step 1 is done', () => {
    render(<Harness initial={{ keyframes: [kf(300, 'trim')] }} />);
    expect(screen.getByTestId('framing-guide-text').textContent).toBe('Drag your box onto your player.');
  });

  it('Trim and SlowMo swaps the guide to the split instruction and pulses the track', () => {
    unlocked();
    fireEvent.click(screen.getByRole('button', { name: 'Trim and SlowMo' }));
    expect(screen.getByTestId('framing-guide-text').textContent).toMatch(/split your clip/i);
    expect(screen.getByTestId('trim-guide-scope').dataset.trimGuide).toBe('split');
  });

  it('once a split exists the trim guide points at the speed and trash buttons', () => {
    const view = unlocked();
    fireEvent.click(screen.getByRole('button', { name: 'Trim and SlowMo' }));
    view.rerender(<Harness initial={{ keyframes: [kf(10)], isPlaying: true, segmentBoundaries: [0, 4, 10] }} />);
    expect(screen.getByTestId('framing-guide-text').textContent).toMatch(/0\.5x/);
    expect(screen.getByTestId('trim-guide-scope').dataset.trimGuide).toBe('adjust');
  });

  it('pressing Trim and SlowMo again returns to the keep-the-box instruction', () => {
    unlocked();
    const trim = screen.getByRole('button', { name: 'Trim and SlowMo' });
    fireEvent.click(trim);
    fireEvent.click(trim);
    expect(screen.getByTestId('framing-guide-text').textContent).toBe('Keep the box around your player.');
    expect(screen.getByTestId('trim-guide-scope').dataset.trimGuide).toBe('off');
  });

  it('does not render the guide in fullscreen', () => {
    render(<Harness initial={{ isFullscreen: true }} />);
    expect(screen.queryByTestId('framing-guide-text')).toBeNull();
  });
});
