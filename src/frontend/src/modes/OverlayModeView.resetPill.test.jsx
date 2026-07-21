import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

/**
 * T5658: the "Back to spotlight" pill was relabeled "Reset" (RotateCcw icon)
 * and its action changed from "return to the spotlight span" to "seek to 0" —
 * because the spotlight location isn't guaranteed, so resetting to the start
 * is the dependable behavior. This pins the render + click-handler contract.
 */

vi.mock('../components/VideoPlayer', () => ({ VideoPlayer: () => <div /> }));
vi.mock('../components/Controls', () => ({ Controls: () => <div /> }));
vi.mock('../components/ZoomControls', () => ({ default: () => <div /> }));
vi.mock('../components/ExportButtonView', () => ({
  default: () => <div data-testid="overlay-export-button">Export</div>,
}));
vi.mock('../containers/ExportButtonContainer', () => ({
  ExportButtonContainer: () => ({}),
  HIGHLIGHT_EFFECT_LABELS: {},
  EXPORT_CONFIG: {},
}));
vi.mock('../components/shared', () => ({ Button: ({ children }) => <button>{children}</button> }));
vi.mock('../components/shared/clipConstants', () => ({ formatTimeSimple: () => '0:00' }));
vi.mock('./overlay', () => ({
  OverlayMode: () => <div data-testid="overlay-timeline" />,
  HighlightOverlay: () => <div />,
  PlayerDetectionOverlay: () => <div />,
}));
vi.mock('../hooks/useFullscreenControls', () => ({
  useFullscreenControls: () => ({
    isVisible: true,
    handleInteraction: () => {},
    handleLongPressTouchStart: () => {},
    handleLongPressTouchMove: () => {},
    handleLongPressTouchEnd: () => {},
  }),
}));
vi.mock('../hooks/useIsMobile', () => ({ useIsMobile: () => false }));

import { OverlayModeView } from './OverlayModeView';

function renderView(overrides = {}) {
  const props = {
    videoRef: { current: null },
    effectiveOverlayVideoUrl: 'blob:overlay',
    effectiveOverlayMetadata: { width: 1920, height: 1080, framerate: 30, duration: 10 },
    isFullscreen: false,
    handlers: {},
    highlightRegions: [],
    highlightBoundaries: [],
    highlightRegionKeyframes: [],
    getTimelineScale: () => 1,
    getRegionsForExport: () => [],
    ...overrides,
  };
  return render(<OverlayModeView {...props} />);
}

describe('OverlayModeView "Reset" pill (T5658)', () => {
  it('does not render when the playhead has not run past the spotlight', () => {
    renderView({ isPastSpotlight: false });
    expect(screen.queryByRole('button', { name: 'Reset' })).toBeNull();
  });

  it('renders "Reset" with a RotateCcw icon once past the spotlight', () => {
    renderView({ isPastSpotlight: true });
    const pill = screen.getByRole('button', { name: 'Reset' });
    expect(pill).toBeTruthy();
    expect(pill.getAttribute('title')).toBe('Reset to the start');
    expect(pill.querySelector('svg.lucide-rotate-ccw')).toBeTruthy();
  });

  it('invokes the seek-to-0 handler (onReturnToSpotlight) on click, not a spotlight-return', () => {
    const onReturnToSpotlight = vi.fn();
    renderView({ isPastSpotlight: true, onReturnToSpotlight });
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(onReturnToSpotlight).toHaveBeenCalledTimes(1);
  });
});
