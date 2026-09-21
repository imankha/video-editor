import { render, screen, fireEvent } from '@testing-library/react';
import { createRef } from 'react';
import FocusCockpit from '../FocusCockpit';

// The heavy stage/export dependencies are mocked so the test focuses on the
// cockpit's own structure (the four zones, safe-area padding, absolute sheets).
vi.mock('../../../../components/VideoPlayer', () => ({
  VideoPlayer: () => <div data-testid="mock-videoplayer" />,
}));
vi.mock('../../overlays/CropOverlay', () => ({ default: () => <div data-testid="mock-cropoverlay" /> }));
vi.mock('../../../../components/ClipSelectorSidebar', () => ({
  ClipSelectorSidebar: () => <div data-testid="mock-clip-sidebar" />,
}));
vi.mock('../../../../components/settings/FocusSettingsPanel', () => ({ default: () => <div data-testid="mock-settings" /> }));
vi.mock('../../../../hooks/useVideoDisplayRect', () => ({ default: () => ({ rect: null }) }));
vi.mock('../../../../containers/ExportButtonContainer', () => ({
  ExportButtonContainer: () => ({
    handleExportRef: { current: null },
    isExporting: false,
    isCurrentlyExporting: false,
    isButtonDisabled: false,
    estimatedCredits: 6,
    creditBalance: 10,
    handleExport: vi.fn(),
    showBuyCredits: false,
    onCloseBuyCredits: vi.fn(),
    onCloseInsufficientCredits: vi.fn(),
    onPaymentSuccess: vi.fn(),
    showInsufficientCredits: null,
  }),
}));

function renderCockpit(overrides = {}) {
  const props = {
    videoRef: createRef(),
    videoUrl: 'blob:x',
    metadata: { width: 1920, height: 1080 },
    currentCropState: { x: 0.1, y: 0.1, width: 0.3, height: 0.5 },
    aspectRatio: '9:16',
    keyframes: [],
    framerate: 30,
    currentTime: 1,
    duration: 6,
    isPlaying: false,
    togglePlay: vi.fn(),
    stepForward: vi.fn(),
    stepBackward: vi.fn(),
    seek: vi.fn(),
    onExitToHome: vi.fn(),
    clipTitle: 'Play 23',
    clipSidebarProps: { onSelectClip: vi.fn() },
    exportButtonRef: createRef(),
    ...overrides,
  };
  return { props, ...render(<FocusCockpit {...props} />) };
}

describe('FocusCockpit (T10840 shell)', () => {
  it('renders all four zones', () => {
    renderCockpit();
    expect(screen.getByTestId('cockpit-transport')).toBeTruthy();
    expect(screen.getByTestId('cockpit-stage')).toBeTruthy();
    expect(screen.getByTestId('cockpit-timeline')).toBeTruthy();
    expect(screen.getByTestId('cockpit-actions')).toBeTruthy();
  });

  it('uses h-dvh + overflow-hidden, never h-screen / inset-0 (D7 iOS-toolbar invariant)', () => {
    renderCockpit();
    const shell = screen.getByTestId('focus-cockpit');
    expect(shell.className).toContain('h-dvh');
    expect(shell.className).toContain('overflow-hidden');
    expect(shell.className).not.toContain('h-screen');
    expect(shell.className).not.toContain('inset-0');
  });

  it('is fixed inset-x-0 top-0 (the positioning that pairs with the safe-area insets, D7)', () => {
    // NOTE: jsdom cannot represent `env(safe-area-inset-*)` and drops the whole
    // inline style, so the env() padding itself (the single most likely shipping
    // bug — play button behind the iOS notch) is verified by the OWED real-device
    // iOS landscape check, not here. What IS assertable is the positioning it
    // depends on: a full-bleed fixed shell anchored top / inset-x, never inset-0.
    renderCockpit();
    const shell = screen.getByTestId('focus-cockpit');
    expect(shell.className).toContain('fixed');
    expect(shell.className).toContain('inset-x-0');
    expect(shell.className).toContain('top-0');
  });

  it('mounts the sheets as absolute (never fixed) inside the shell (D6)', () => {
    renderCockpit();
    const sheets = screen.getAllByTestId('cockpit-sheet');
    expect(sheets.length).toBe(3); // Clips / Setup / Trim
    sheets.forEach((s) => {
      expect(s.className).toContain('absolute');
      expect(s.className).not.toContain('fixed');
    });
  });

  it('the Clips rail button opens the Clips sheet (slides in from the right)', () => {
    renderCockpit();
    const clipsSheet = screen
      .getAllByTestId('cockpit-sheet')
      .find((s) => s.getAttribute('aria-label') === 'Clips');
    expect(clipsSheet.getAttribute('style')).toContain('translateX(100%)'); // closed
    fireEvent.click(screen.getByTestId('cockpit-clips-btn'));
    expect(clipsSheet.getAttribute('style')).toContain('translateX(0)'); // open
  });

  it('has no scroll container in the shell itself (no vertical scroll — overflow hidden)', () => {
    renderCockpit();
    expect(screen.getByTestId('focus-cockpit').className).toContain('overflow-hidden');
  });
});
