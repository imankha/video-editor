import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

/**
 * T4880: on mobile the editor used an always-on fullscreen video takeover
 * (`mobileFs = isMobile`) that rendered the below-timeline controls under a
 * `!mobileFs` guard — so the Export / "Proceed to Overlay" button was never
 * rendered on a phone and the framing -> overlay flow could not be completed.
 *
 * The fix makes mobile default to the inline scrollable layout (fullscreen is
 * opt-in), so the export/proceed control is present and reachable. This test
 * pins that: with `useIsMobile() === true`, the export button renders.
 * Pre-fix this fails (the button is gated out on mobile).
 */

vi.mock('../components/VideoPlayer', () => ({ VideoPlayer: () => <div /> }));
vi.mock('../components/Controls', () => ({ Controls: () => <div /> }));
vi.mock('../components/ZoomControls', () => ({ default: () => <div /> }));
vi.mock('../components/AspectRatioSelector', () => ({ default: () => <div /> }));
vi.mock('../components/ExportButtonView', () => ({
  default: () => <div data-testid="export-button">Continue to Overlay</div>,
}));
vi.mock('../containers/ExportButtonContainer', () => ({
  ExportButtonContainer: () => ({}),
  HIGHLIGHT_EFFECT_LABELS: {},
  EXPORT_CONFIG: {},
}));
vi.mock('../components/shared', () => ({ Button: ({ children }) => <button>{children}</button> }));
vi.mock('../components/shared/clipConstants', () => ({ formatTimeSimple: () => '0:00' }));
vi.mock('./framing', () => ({ FramingMode: () => <div />, CropOverlay: () => <div /> }));
vi.mock('../hooks/useFullscreenControls', () => ({
  useFullscreenControls: () => ({
    isVisible: true,
    handleInteraction: () => {},
    handleLongPressTouchStart: () => {},
    handleLongPressTouchMove: () => {},
    handleLongPressTouchEnd: () => {},
  }),
}));

// Toggled per-test.
const isMobileMock = vi.fn(() => false);
vi.mock('../hooks/useIsMobile', () => ({ useIsMobile: () => isMobileMock() }));

import { FramingModeView } from './FramingModeView';

function renderView(overrides = {}) {
  const props = {
    videoRef: { current: null },
    videoUrl: 'blob:video',
    metadata: { width: 1920, height: 1080, framerate: 30 },
    isFullscreen: false,
    handlers: {},
    aspectRatio: '9:16',
    globalAspectRatio: '16:9',
    onAspectRatioChange: vi.fn(),
    keyframes: [],
    clipsWithCurrentState: [],
    getTimelineScale: () => 1,
    getSegmentExportData: () => ({}),
    getFilteredKeyframesForExport: () => [],
    ...overrides,
  };
  return render(<FramingModeView {...props} />);
}

describe('FramingModeView export reachability on mobile (T4880)', () => {
  it('renders the export / proceed-to-overlay button on a mobile viewport', () => {
    isMobileMock.mockReturnValue(true);
    renderView();
    // The below-timeline export control must exist on mobile (default layout is
    // inline+scrollable, not the fullscreen takeover that hid it).
    expect(screen.getByTestId('export-button')).toBeTruthy();
  });

  it('still renders the export button on desktop (no regression)', () => {
    isMobileMock.mockReturnValue(false);
    renderView();
    expect(screen.getByTestId('export-button')).toBeTruthy();
  });
});
