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
vi.mock('../components/shared/clipConstants', () => ({ DEFAULT_CLIP_BEFORE: 6, DEFAULT_CLIP_AFTER: 2, formatTimeSimple: () => '0:00' }));
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
vi.mock('../hooks/useIsMobile', () => ({ useIsMobile: () => isMobileMock(), useIsLandscape: () => false, useIsPhonePortrait: () => false, useIsSmallPhoneViewport: () => false }));

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

  // T12440: jsdom has no layout; assert the sizing contract. The stage height leaves room
  // for the pinned band (--cta-bar-h) PLUS 22rem of header + controls + timeline, so the
  // Play button and timeline are never under the band. T12640 wrapped the cap in max(20rem, ...)
  // so a short viewport (1024x768) keeps a usable video instead of collapsing to ~100px wide.
  // T13610: the floor is 30rem (480px) so a portrait pick video is tappable at 1440x900.
  it('caps the stage height so controls and timeline clear the pinned action band (T12440)', () => {
    isMobileMock.mockReturnValue(false);
    renderView({ effectiveOverlayMetadata: { width: 808, height: 1440, duration: 10 } });
    const stage = screen.getByTestId('overlay-video-stage');
    expect(stage.className).toContain('lg:h-[max(30rem,min(70vh,calc(100dvh-var(--cta-bar-h,0px)-22rem)))]');
    expect(stage.className).toContain('lg:max-h-[max(30rem,min(70vh,calc(100dvh-var(--cta-bar-h,0px)-22rem)))]');
  });

  // T14850: below ~850px of viewport height the 30rem floor forces more height than
  // the sticky ActionBand + 22rem header reservation leaves room for, overflowing the
  // video under the band (measured 54px overlap at 1280x800). A media-gated
  // `!`-important override lowers the floor to 320px ONLY in that height range,
  // leaving the T13610 tall-viewport (30rem) fix untouched.
  // T15400: widened from `(min-width:1024px)_and_(max-height:850px)` -- the floor is a
  // pure `max(320px, ...)` on the same formula, so it's safe (a no-op once already
  // >=320px) at every `min-width:1024px` height. This closed the gap at 1440x900
  // (height 900, previously past the 850px ceiling and still clipped under the band).
  it('T14850/T15400:C2 lowers the floor to 320px at every min-width:1024px height', () => {
    isMobileMock.mockReturnValue(false);
    renderView({ effectiveOverlayMetadata: { width: 808, height: 1440, duration: 10 } });
    const stage = screen.getByTestId('overlay-video-stage');
    expect(stage.className).toContain(
      '[@media(min-width:1024px)]:!h-[max(320px,min(70vh,calc(100dvh-var(--cta-bar-h,0px)-22rem)))]',
    );
    expect(stage.className).toContain(
      '[@media(min-width:1024px)]:!max-h-[max(320px,min(70vh,calc(100dvh-var(--cta-bar-h,0px)-22rem)))]',
    );
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

  it('renders the desktop settings rail beside the video, replacing the old tabbed section', () => {
    isMobileMock.mockReturnValue(false);
    renderView();
    // T9270 step 4: the desktop settings column is the unified SettingsRail
    // (data-testid="settings-rail"). The old stacked OverlaySettingsTabs
    // (data-testid="overlay-settings-tabs") is fully retired — on mobile the same
    // rail renders as the translateX drawer instead.
    expect(screen.getByTestId('settings-rail')).toBeTruthy();
    expect(screen.queryByTestId('overlay-settings-tabs')).toBeNull();
  });
});
