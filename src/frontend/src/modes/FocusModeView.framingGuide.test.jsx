import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

/**
 * T9610: FocusModeView mounts the three-step framing guide and derives its default
 * expand/collapse from the placed focus-point count (expanded until two 'user'-origin
 * keyframes exist; collapsible thereafter via a gesture override).
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
    keyframes: [],
    clipsWithCurrentState: [],
    getTimelineScale: () => 1,
    getSegmentExportData: () => ({}),
    getFilteredKeyframesForExport: () => [],
    ...overrides,
  };
  return render(<FocusModeView {...props} />);
}

const kf = (frame, origin = 'user') => ({ frame, x: 0, y: 0, width: 100, height: 100, origin });

describe('FocusModeView framing guide (T9610)', () => {
  it('renders the guide expanded by default before the first framing success', () => {
    renderView({ keyframes: [kf(10)] });
    const toggle = screen.getByTestId('framing-instructions-toggle');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('framing-instructions').querySelector('ol')).not.toBeNull();
  });

  it('collapses the guide by default once two focus points are placed', () => {
    renderView({ keyframes: [kf(10), kf(40)] });
    const toggle = screen.getByTestId('framing-instructions-toggle');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByTestId('framing-instructions').querySelector('ol')).toBeNull();
  });

  it('ignores trim-origin keyframes when counting focus points', () => {
    // One real focus point + a trim boundary keyframe → still "not yet successful".
    renderView({ keyframes: [kf(10, 'user'), kf(300, 'trim')] });
    expect(screen.getByTestId('framing-instructions-toggle').getAttribute('aria-expanded')).toBe('true');
  });

  it('lets the user expand the guide after success (gesture override)', () => {
    renderView({ keyframes: [kf(10), kf(40)] });
    const toggle = screen.getByTestId('framing-instructions-toggle');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(screen.getByTestId('framing-instructions-toggle').getAttribute('aria-expanded')).toBe('true');
  });
});
