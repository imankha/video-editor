import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

/**
 * T9950 Slice 1: the segment/speed/trim track collapses behind a "Trim and
 * slow motion" disclosure (renamed from "Advanced editing" 2026-09-18, then
 * "Trim and SlowMo" -> "Trim and slow motion" in 3662653a0; testid unchanged).
 * The original R4 default (open when the clip already has splits or a trim
 * range) was reversed in 134b1c6c4 ("opt-in editing steps"): the track is
 * opt-in every time and stays collapsed until the user opens it, even when
 * the clip already has saved edits. The edits themselves are untouched.
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
let lastFocusModeProps = null;
vi.mock('./focus', () => ({
  FocusMode: (props) => {
    lastFocusModeProps = props;
    return <div />;
  },
  CropOverlay: () => <div />,
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
    keyframes: [{ frame: 10, x: 0, y: 0, width: 100, height: 100, origin: 'user' }],
    clipsWithCurrentState: [],
    getTimelineScale: () => 1,
    getSegmentExportData: () => ({}),
    getFilteredKeyframesForExport: () => [],
    // Trim and SlowMo is locked until the guided steps are done (drag + play).
    isPlaying: true,
    ...overrides,
  };
  return render(<FocusModeView {...props} />);
}

describe('FocusModeView Advanced editing disclosure (T9950 Slice 1)', () => {
  it('defaults collapsed for a fresh clip with no splits or trim', () => {
    renderView({ segmentBoundaries: [0, 100], trimRange: null });
    const toggle = screen.getByTestId('trim-slowmo-button');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(lastFocusModeProps.showSegments).toBe(false);
  });

  // Regression (2026-09-18 user request): the disclosure's label was renamed
  // from "Advanced editing" to name what it reveals (segment/speed/trim
  // controls). Current copy is "Trim and slow motion" (3662653a0).
  it('labels the button "Trim and slow motion"', () => {
    renderView({ segmentBoundaries: [0, 100], trimRange: null });
    expect(screen.getByRole('button', { name: 'Trim and slow motion' })).toBe(
      screen.getByTestId('trim-slowmo-button'),
    );
  });

  // 134b1c6c4: Trim and slow motion is opt-in every time; saved splits do not
  // auto-open it. Opening it still reveals the existing split.
  it('stays collapsed when the clip already has a user split, and opens on click', () => {
    renderView({ segmentBoundaries: [0, 50, 100], trimRange: null });
    const toggle = screen.getByTestId('trim-slowmo-button');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(lastFocusModeProps.showSegments).toBe(false);
    fireEvent.click(toggle);
    expect(screen.getByTestId('trim-slowmo-button').getAttribute('aria-pressed')).toBe('true');
    expect(lastFocusModeProps.showSegments).toBe(true);
    expect(lastFocusModeProps.segmentBoundaries).toEqual([0, 50, 100]);
  });

  it('stays collapsed when the clip already has a trim range (134b1c6c4 opt-in)', () => {
    renderView({ segmentBoundaries: [0, 100], trimRange: { start: 0, end: 50 } });
    expect(screen.getByTestId('trim-slowmo-button').getAttribute('aria-pressed')).toBe('false');
    expect(lastFocusModeProps.showSegments).toBe(false);
  });

  it('toggles open/closed on click (gesture override)', () => {
    renderView({ segmentBoundaries: [0, 100], trimRange: null });
    const toggle = screen.getByTestId('trim-slowmo-button');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(toggle);
    expect(screen.getByTestId('trim-slowmo-button').getAttribute('aria-pressed')).toBe('true');
    expect(lastFocusModeProps.showSegments).toBe(true);
    fireEvent.click(screen.getByTestId('trim-slowmo-button'));
    expect(screen.getByTestId('trim-slowmo-button').getAttribute('aria-pressed')).toBe('false');
  });

  it('does not render the disclosure without a video', () => {
    renderView({ videoUrl: '' });
    expect(screen.queryByTestId('trim-slowmo-button')).toBeNull();
  });
});
