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
vi.mock('../components/shared', () => ({
  Button: ({ children }) => <button>{children}</button>,
  Toggle: ({ checked, onChange }) => (
    <button role="switch" aria-checked={checked} onClick={() => onChange?.(!checked)} />
  ),
}));
vi.mock('../components/shared/clipConstants', () => ({ formatTimeSimple: () => '0:00' }));
vi.mock('./focus', () => ({ FocusMode: () => <div />, CropOverlay: () => <div /> }));
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

import { FocusModeView } from './FocusModeView';

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
  return render(<FocusModeView {...props} />);
}

describe('FocusModeView export reachability on mobile (T4880 / T9270)', () => {
  // T9270 changed the guarantee from "present" to "above the fold": the real
  // in-viewport boundingBox() proof lives in the T9270 e2e specs (jsdom has no
  // layout). Here we pin the MECHANISM that keeps it above the fold at every width
  // — the CTA renders inside the `sticky bottom-0` action band, so it stays pinned
  // to the viewport bottom against App's `flex-1 overflow-auto` scroll container.
  it('renders the export CTA inside the sticky-pinned action band on mobile', () => {
    isMobileMock.mockReturnValue(true);
    renderView();
    const cta = screen.getByTestId('export-button');
    expect(cta).toBeTruthy();
    const band = cta.closest('.sticky');
    expect(band, 'CTA is wrapped by the sticky action band').toBeTruthy();
    expect(band.className).toMatch(/bottom-0/);
  });

  it('keeps the CTA in the sticky band on desktop too (band is not lg:static — no regression)', () => {
    isMobileMock.mockReturnValue(false);
    renderView();
    const cta = screen.getByTestId('export-button');
    const band = cta.closest('.sticky');
    expect(band, 'CTA is pinned at every width, not just mobile').toBeTruthy();
    expect(band.className).toMatch(/bottom-0/);
  });
});
