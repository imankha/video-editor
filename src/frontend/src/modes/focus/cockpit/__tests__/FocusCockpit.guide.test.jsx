import { render, screen, fireEvent, act } from '@testing-library/react';
import { createRef } from 'react';
import FocusCockpit from '../FocusCockpit';
import { useSettingsStore } from '../../../../stores/settingsStore';
import { GUIDE } from '../../../../config/displayNames';
import { COCKPIT_INTRO_SEEN_KEY } from '../CockpitIntroCard';

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
// T12770: the stub reads the REAL GuideScope the way CropOverlay's box does.
vi.mock('../../overlays/CropOverlay', async () => {
  const { useGuidePulse } = await import('../../../../components/instructions/GuideScope');
  const { GUIDE_PULSE } = await import('../../../../components/instructions/guideTargets');
  return {
    default: function CropOverlayStub(props) {
      cropOverlayCapture.last = props;
      return <div data-testid="mock-cropoverlay" className={useGuidePulse(GUIDE_PULSE.CROP_BOX)} />;
    },
  };
});
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


// T12790: the landscape cockpit showed no guide sentence at all (only the crop-box cue).
// It now walks the same steps as portrait in a compact strip at the foot of the stage.
const FOCUS_POINT = [{ frame: 10, origin: 'user', x: 0, y: 0, width: 1, height: 1 }];
const text = () => screen.queryByTestId('cockpit-guide-text')?.textContent ?? null;

describe('FocusCockpit guide sentence (T12790)', () => {
  const setGuidance = (coachEnabled) => useSettingsStore.setState((st) => ({
    settings: { ...st.settings, guidance: { ...st.settings.guidance, coachEnabled } },
  }));
  beforeEach(() => { localStorage.setItem(COCKPIT_INTRO_SEEN_KEY, '1'); setGuidance(true); });
  afterEach(() => { localStorage.removeItem(COCKPIT_INTRO_SEEN_KEY); });

  it('says to drag the box before any focus point', () => {
    renderCockpit({ keyframes: [] });
    expect(text()).toBe(GUIDE.focus.drag);
  });

  it('then Preview (pulsing the rail button), then Generate (pulsing the CTA)', () => {
    renderCockpit({ keyframes: FOCUS_POINT });
    expect(text()).toBe(GUIDE.focus.cockpitPreview);
    expect(screen.getByTestId('cockpit-preview-btn').className).toContain('coach-target-pulse');
    fireEvent.click(screen.getByTestId('cockpit-preview-btn'));
    expect(text()).toBe(GUIDE.focus.cockpitWatchPreview);
    fireEvent.click(screen.getByTestId('cockpit-preview-btn'));
    expect(text()).toBe(GUIDE.focus.generate);
    expect(screen.getByTestId('primary-cta').className).toContain('coach-target-pulse');
  });

  it('export job state outranks the steps', () => {
    renderCockpit({ keyframes: FOCUS_POINT, jobStatus: 'processing' });
    expect(text()).toBe(GUIDE.focus.progressExport);
  });

  it('stays out of the way of the first-entry card and follows Guidance', () => {
    localStorage.removeItem(COCKPIT_INTRO_SEEN_KEY);
    const { unmount } = renderCockpit({ keyframes: [] });
    expect(text()).toBeNull();
    unmount();
    localStorage.setItem(COCKPIT_INTRO_SEEN_KEY, '1');
    setGuidance(false);
    renderCockpit({ keyframes: [] });
    expect(text()).toBeNull();
  });
});

describe('FocusCockpit guide on a failed load (T12790 review)', () => {
  beforeEach(() => {
    localStorage.setItem(COCKPIT_INTRO_SEEN_KEY, '1');
    useSettingsStore.setState((st) => ({ settings: { ...st.settings, guidance: { ...st.settings.guidance, coachEnabled: true } } }));
  });
  afterEach(() => { localStorage.removeItem(COCKPIT_INTRO_SEEN_KEY); });

  it('says to retry instead of walking the steps', () => {
    renderCockpit({ keyframes: [], error: 'Video link expired', isUrlExpiredError: () => true, onRetryVideo: vi.fn() });
    expect(screen.getByTestId('cockpit-guide-text').textContent).toBe(GUIDE.focus.videoErrorRetry);
  });
});

describe('FocusCockpit is silent while the CTA is busy (T12790 review)', () => {
  beforeEach(() => {
    localStorage.setItem(COCKPIT_INTRO_SEEN_KEY, '1');
    useSettingsStore.setState((st) => ({ settings: { ...st.settings, guidance: { ...st.settings.guidance, coachEnabled: true } } }));
  });
  afterEach(() => { localStorage.removeItem(COCKPIT_INTRO_SEEN_KEY); });

  it('shows no step while the finished render is opening', () => {
    renderCockpit({ keyframes: FOCUS_POINT, framingCtaMode: 'opening' });
    expect(screen.queryByTestId('cockpit-guide-text')).toBeNull();
  });
});
