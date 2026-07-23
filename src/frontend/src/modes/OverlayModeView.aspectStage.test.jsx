import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

/**
 * T5676: aspect-aware video stage (kill the 9:16 pillarbox).
 *
 * The Overlay stage used to be a fixed-height, full-column-width box, so a 9:16
 * reel `object-contain`ed into a ~16:9 area with ~2/3 side pillarbox. The fix
 * sizes the (non-fullscreen) stage box to the reel's true pixel aspect ratio via
 * an inline `aspect-ratio` style, so the box shrink-wraps the video. The Overlay
 * Settings card is extracted and placed beside the video on desktop + stacked on
 * mobile (two DOM copies, breakpoint-gated).
 *
 * These pin: (1) the stage box carries the metadata-derived aspect-ratio for both
 * portrait and landscape reels, (2) it does NOT impose an aspect-ratio in
 * fullscreen (CSS :fullscreen sizes the full viewport there), (3) both settings-card
 * placements render.
 */

vi.mock('../components/VideoPlayer', () => ({ VideoPlayer: () => <div data-testid="video-player" /> }));
vi.mock('../components/Controls', () => ({ Controls: () => <div /> }));
vi.mock('../components/ZoomControls', () => ({ default: () => <div /> }));
vi.mock('../components/ExportButtonView', () => ({
  default: () => <div data-testid="overlay-export-button">Export</div>,
}));
vi.mock('../containers/ExportButtonContainer', () => ({
  ExportButtonContainer: () => ({}),
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

const isMobileMock = vi.fn(() => false);
vi.mock('../hooks/useIsMobile', () => ({ useIsMobile: () => isMobileMock() }));

import { OverlayModeView } from './OverlayModeView';

function renderView(overrides = {}) {
  const props = {
    videoRef: { current: null },
    effectiveOverlayVideoUrl: 'blob:overlay',
    effectiveOverlayMetadata: { width: 808, height: 1440, framerate: 30, duration: 10 },
    isFullscreen: false,
    handlers: {},
    highlightRegions: [],
    highlightBoundaries: [],
    highlightRegionKeyframes: [],
    getTimelineScale: () => 1,
    getRegionsForExport: () => [],
    isTimeInEnabledRegion: () => false,
    ...overrides,
  };
  return render(<OverlayModeView {...props} />);
}

describe('OverlayModeView aspect-fit stage (T5676)', () => {
  it('sizes the stage box to a 9:16 reel aspect ratio', () => {
    isMobileMock.mockReturnValue(false);
    renderView({ effectiveOverlayMetadata: { width: 808, height: 1440, duration: 10 } });
    const stage = screen.getByTestId('overlay-video-stage');
    expect(stage.style.aspectRatio).toBe('808 / 1440');
  });

  it('adapts the stage box to a 16:9 reel (no hardcoded portrait)', () => {
    isMobileMock.mockReturnValue(false);
    renderView({ effectiveOverlayMetadata: { width: 1920, height: 1080, duration: 10 } });
    const stage = screen.getByTestId('overlay-video-stage');
    expect(stage.style.aspectRatio).toBe('1920 / 1080');
  });

  it('does NOT impose an aspect-ratio in fullscreen (CSS sizes the full viewport)', () => {
    isMobileMock.mockReturnValue(false);
    renderView({ isFullscreen: true });
    const stage = screen.getByTestId('overlay-video-stage');
    expect(stage.style.aspectRatio).toBe('');
  });

  it('renders the Overlay Settings card in both the desktop-beside and mobile-stacked slots', () => {
    isMobileMock.mockReturnValue(false);
    renderView();
    // One copy in the desktop two-column row (hidden lg:block) + one in the
    // mobile stacked slot (lg:hidden); both are in the DOM under jsdom.
    expect(screen.getAllByText('Overlay Settings')).toHaveLength(2);
  });
});
