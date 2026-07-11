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

describe('OverlayModeView export/settings reachability on mobile (T4880)', () => {
  it('renders the overlay settings/export control and timeline on a mobile viewport', () => {
    isMobileMock.mockReturnValue(true);
    renderView();
    expect(screen.getByTestId('overlay-export-button')).toBeTruthy();
    expect(screen.getByTestId('overlay-timeline')).toBeTruthy();
  });

  it('still renders the overlay export control on desktop (no regression)', () => {
    isMobileMock.mockReturnValue(false);
    renderView();
    expect(screen.getByTestId('overlay-export-button')).toBeTruthy();
  });
});
