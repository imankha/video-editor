import { render, screen, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

/**
 * T12030: the Overlay bottom band is a CtaBar-shaped ActionBand. The "Add text"
 * card is a secondary INSIDE the band beside Generate (not a separate w-52 cell),
 * and the hidden lg:flex metadata row renders ABOVE the sticky band, not after it,
 * so it cannot collide with the band.
 *
 * The real ExportButtonView renders here (no mock) so the band structure is the
 * production one. The rect-level no-collision check is the Playwright spec.
 */

vi.mock('../components/VideoPlayer', () => ({ VideoPlayer: () => <div data-testid="video-player" /> }));
vi.mock('../components/Controls', () => ({ Controls: () => <div /> }));
vi.mock('../components/ZoomControls', () => ({ default: () => <div /> }));
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
vi.mock('../hooks/useIsMobile', () => ({ useIsMobile: () => false, useIsLandscape: () => false, useIsPhonePortrait: () => false, useIsSmallPhoneViewport: () => false }));

import { OverlayModeView } from './OverlayModeView';

function renderView() {
  return render(
    <OverlayModeView
      videoRef={{ current: null }}
      effectiveOverlayVideoUrl="blob:overlay"
      effectiveOverlayMetadata={{ width: 808, height: 1440, framerate: 30, duration: 10 }}
      isFullscreen={false}
      handlers={{}}
      highlightRegions={[]}
      highlightBoundaries={[]}
      highlightRegionKeyframes={[]}
      getTimelineScale={() => 1}
      getRegionsForExport={() => []}
      isTimeInEnabledRegion={() => false}
    />
  );
}

describe('OverlayModeView action band (T12030)', () => {
  it('puts the Add text card inside the action band, beside the export CTA', () => {
    renderView();
    const band = screen.getByTestId('action-band');
    const addText = within(band).getByTestId('overlay-add-text-button');
    const aboveRow = within(band).getByTestId('action-band-above');
    expect(aboveRow.contains(addText)).toBe(true);
  });

  it('orders Generate before Add text in the band (CTA first)', () => {
    renderView();
    const addText = screen.getByTestId('overlay-add-text-button');
    const cta = screen.getByTestId('action-band-above').firstElementChild;
    expect(cta.compareDocumentPosition(addText) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('renders the technical metadata row above the sticky band, not after it', () => {
    renderView();
    const band = screen.getByTestId('action-band');
    const metadata = screen.getByText('808x1440');
    // The band must come AFTER the metadata row in document order.
    expect(metadata.compareDocumentPosition(band) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
