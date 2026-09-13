import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

/**
 * T9480 review fix (BLOCKING #2) -- OutputLengthChip is a LENGTH on the exact
 * billing-adjacent surface (its own tooltip says "what you export and are
 * billed for"), so it must ROUND half-up (formatLength), not FLOOR
 * (formatInstant) -- a 6.6s output must read "0:07" (matching the 7 credits
 * charged), never the floored "0:06" that reproduced the original complaint.
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
vi.mock('../stores/editorStore', () => ({ useEditorStore: () => () => {} }));

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

describe('OutputLengthChip (T9480 review fix, BLOCKING #2)', () => {
  it('rounds a 6.6s output to "0:07", matching the 7 credits it bills -- not the floored "0:06"', () => {
    renderView({ selectedClipEffectiveDuration: 6.6 });
    const chip = screen.getAllByTestId('output-length-chip')[0];
    expect(chip.textContent).toBe('Output: 0:07');
  });

  it('rounds a 2.45s output to "0:02" (half-up, single-step -- not a double-rounded "0:03")', () => {
    renderView({ selectedClipEffectiveDuration: 2.45 });
    const chip = screen.getAllByTestId('output-length-chip')[0];
    expect(chip.textContent).toBe('Output: 0:02');
  });
});
