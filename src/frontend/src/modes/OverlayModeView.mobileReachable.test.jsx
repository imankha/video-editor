import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

/**
 * T4880: on mobile the overlay editor used an always-on fullscreen video
 * takeover (`mobileFs = isMobile`) that rendered the overlay settings +
 * Export button under a `!mobileFs` guard — so on a phone the user could not
 * reach the settings or export (and the Add Spotlight control sat behind the
 * iOS browser chrome at the very bottom).
 *
 * The fix makes mobile default to the inline scrollable layout (fullscreen is
 * opt-in). This test pins that the below-timeline export/settings control is
 * present with `useIsMobile() === true`. Pre-fix this fails.
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

const isMobileMock = vi.fn(() => false);
vi.mock('../hooks/useIsMobile', () => ({ useIsMobile: () => isMobileMock() }));

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

describe('OverlayModeView export/settings reachability on mobile (T4880 / T9270)', () => {
  // T9270: the "reachable" guarantee is now "above the fold" — the CTA renders in a
  // `sticky bottom-0` action band pinned to the viewport bottom. The real geometry
  // proof is in the T9270 e2e specs (jsdom has no layout); here we pin the mechanism.
  it('renders the Add Overlay CTA inside the sticky-pinned band + the timeline on mobile', () => {
    isMobileMock.mockReturnValue(true);
    renderView();
    const cta = screen.getByTestId('overlay-export-button');
    expect(cta).toBeTruthy();
    expect(screen.getByTestId('overlay-timeline')).toBeTruthy();
    const band = cta.closest('.sticky');
    expect(band, 'CTA is wrapped by the sticky action band').toBeTruthy();
    expect(band.className).toMatch(/bottom-0/);
  });

  it('keeps the CTA in the sticky band on desktop too (no regression)', () => {
    isMobileMock.mockReturnValue(false);
    renderView();
    const cta = screen.getByTestId('overlay-export-button');
    const band = cta.closest('.sticky');
    expect(band, 'CTA is pinned at every width').toBeTruthy();
    expect(band.className).toMatch(/bottom-0/);
  });
});
