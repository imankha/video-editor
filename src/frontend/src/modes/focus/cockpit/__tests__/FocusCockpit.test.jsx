import { render, screen, fireEvent, act } from '@testing-library/react';
import { createRef } from 'react';
import FocusCockpit from '../FocusCockpit';

// The heavy stage/export dependencies are mocked so the test focuses on the
// cockpit's own structure (the four zones, safe-area padding, absolute sheets).
// Render the `overlays` the cockpit passes in (the real VideoPlayer does) so the
// CropOverlay stub below actually mounts and can capture its props.
vi.mock('../../../../components/VideoPlayer', () => ({
  VideoPlayer: ({ overlays }) => <div data-testid="mock-videoplayer">{overlays}</div>,
}));
// Capture the props the cockpit passes into CropOverlay so we can assert the
// coach-cue inputs (focusPointCount / isPlaying) are actually wired through.
const cropOverlayCapture = vi.hoisted(() => ({ last: null }));
vi.mock('../../overlays/CropOverlay', () => ({
  default: (props) => {
    cropOverlayCapture.last = props;
    return <div data-testid="mock-cropoverlay" />;
  },
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

  it('uses h-dvh + overflow-hidden, never h-screen / inset-0 (D7 iOS-toolbar invariant)', () => { // viewport-unit-ok: description text, not a real occurrence
    renderCockpit();
    const shell = screen.getByTestId('focus-cockpit');
    expect(shell.className).toContain('h-dvh');
    expect(shell.className).toContain('overflow-hidden');
    expect(shell.className).not.toContain('h-screen'); // viewport-unit-ok: negative assertion
    expect(shell.className).not.toMatch(/(^|\s)inset-0(\s|$)/);
  });

  it('sits BELOW the modal/player layers so the completion preview + exit dialog cover it (D15)', () => {
    // Regression for the z-[100] shell that out-stacked Z.PLAYER (completion
    // preview) and Z.MODAL (framing-changed exit dialog). The cockpit must be
    // below z-50 (MODAL); Z.DROPDOWN is z-40.
    renderCockpit();
    const shell = screen.getByTestId('focus-cockpit');
    expect(shell.className).toContain('z-40');
    expect(shell.className).not.toContain('z-[100]');
    expect(shell.className).not.toContain('z-[70]');
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
    expect(sheets.length).toBe(2); // Setup / Trim (T11240 removed the Clips sheet)
    sheets.forEach((s) => {
      expect(s.className).toContain('absolute');
      expect(s.className).not.toContain('fixed');
    });
  });

  it('the Setup rail button opens the Setup sheet (slides in from the right)', () => {
    renderCockpit();
    const setupSheet = screen
      .getAllByTestId('cockpit-sheet')
      .find((s) => s.getAttribute('aria-label') === 'Setup');
    expect(setupSheet.getAttribute('style')).toContain('translateX(100%)'); // closed
    fireEvent.click(screen.getByTestId('cockpit-setup-btn'));
    expect(setupSheet.getAttribute('style')).toContain('translateX(0)'); // open
  });

  it('has no scroll container in the shell itself (no vertical scroll — overflow hidden)', () => {
    renderCockpit();
    expect(screen.getByTestId('focus-cockpit').className).toContain('overflow-hidden');
  });

  // T11240: a project is exactly one clip now, so the cockpit's Clips sheet +
  // rail button (dead multi-clip UI) are gone.
  it('renders no Clips rail button', () => {
    renderCockpit();
    expect(screen.queryByTestId('cockpit-clips-btn')).toBeNull();
  });

  // T11710/T11700 reviewer BLOCKING: the cockpit must pass the REAL focusPointCount
  // and isPlaying into CropOverlay — those drive showCoach (ring + coach chip).
  // Omitting them made CropOverlay fall back to focusPointCount=0 / isPlaying=false,
  // so the cues showed PERMANENTLY in landscape even with a keyframe set or during
  // playback. These assert the wiring, not CropOverlay's internal showCoach (proven
  // in CropOverlay.test.jsx).
  it('passes the real focusPointCount (user keyframes, trim-excluded) into CropOverlay', () => {
    cropOverlayCapture.last = null;
    renderCockpit({
      keyframes: [
        { frame: 30, origin: 'user' },
        { frame: 0, origin: 'trim' },   // trim keyframes are NOT focus points
        { frame: 90, origin: 'user' },
      ],
    });
    expect(cropOverlayCapture.last).toBeTruthy();
    expect(cropOverlayCapture.last.focusPointCount).toBe(2);
  });

  it('forwards isPlaying into CropOverlay (so coach cues hide during playback)', () => {
    cropOverlayCapture.last = null;
    renderCockpit({ isPlaying: true, keyframes: [] });
    expect(cropOverlayCapture.last).toBeTruthy();
    expect(cropOverlayCapture.last.isPlaying).toBe(true);
  });

  // Reviewer MAJOR: the cockpit must also wire the DRAG pair (isDragging +
  // onDragStateChange) into CropOverlay, held in local view state exactly as the
  // portrait path does — without it the coach ring/chip stay up for the whole
  // first drag in landscape. Before the fix both were absent (undefined).
  it('wires isDragging + onDragStateChange, and a drag flips isDragging (coach cues hide while dragging)', () => {
    cropOverlayCapture.last = null;
    renderCockpit({ keyframes: [] });
    expect(cropOverlayCapture.last).toBeTruthy();
    expect(typeof cropOverlayCapture.last.onDragStateChange, 'cockpit passes a drag-state setter').toBe('function');
    expect(cropOverlayCapture.last.isDragging, 'isDragging starts false, not undefined').toBe(false);
    // The setter must drive the SAME state CropOverlay reads: a drag-start flips it.
    act(() => { cropOverlayCapture.last.onDragStateChange(true); });
    expect(cropOverlayCapture.last.isDragging, 'drag-start flips isDragging true').toBe(true);
  });
});
