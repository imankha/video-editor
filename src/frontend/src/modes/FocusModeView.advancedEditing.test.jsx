import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

/**
 * T9950 Slice 1: the segment/speed/trim track collapses behind an "Advanced
 * editing" disclosure. Default derives from whether the clip already has user
 * splits or a trim range (design doc §5/§6 R4) — a returning user's existing
 * edits are never hidden by default; a fresh/untouched clip defaults collapsed.
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
    ...overrides,
  };
  return render(<FocusModeView {...props} />);
}

describe('FocusModeView Advanced editing disclosure (T9950 Slice 1)', () => {
  it('defaults collapsed for a fresh clip with no splits or trim', () => {
    renderView({ segmentBoundaries: [0, 100], trimRange: null });
    const toggle = screen.getByTestId('advanced-editing-disclosure');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(lastFocusModeProps.showSegments).toBe(false);
  });

  it('defaults expanded when the clip already has a user split (R4)', () => {
    renderView({ segmentBoundaries: [0, 50, 100], trimRange: null });
    const toggle = screen.getByTestId('advanced-editing-disclosure');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(lastFocusModeProps.showSegments).toBe(true);
  });

  it('defaults expanded when the clip already has a trim range (R4)', () => {
    renderView({ segmentBoundaries: [0, 100], trimRange: { start: 0, end: 50 } });
    expect(screen.getByTestId('advanced-editing-disclosure').getAttribute('aria-expanded')).toBe('true');
  });

  it('toggles open/closed on click (gesture override)', () => {
    renderView({ segmentBoundaries: [0, 100], trimRange: null });
    const toggle = screen.getByTestId('advanced-editing-disclosure');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(screen.getByTestId('advanced-editing-disclosure').getAttribute('aria-expanded')).toBe('true');
    expect(lastFocusModeProps.showSegments).toBe(true);
    fireEvent.click(screen.getByTestId('advanced-editing-disclosure'));
    expect(screen.getByTestId('advanced-editing-disclosure').getAttribute('aria-expanded')).toBe('false');
  });

  it('does not render the disclosure without a video', () => {
    renderView({ videoUrl: '' });
    expect(screen.queryByTestId('advanced-editing-disclosure')).toBeNull();
  });
});
