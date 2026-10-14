import { act, render, screen, fireEvent } from '@testing-library/react';
import { GUIDE } from '../config/displayNames';
import { useSettingsStore } from '../stores/settingsStore';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Guided framing steps: ONE instruction at a time (drag the box -> play -> keep the
 * box on your player). Preview highlight, Trim and SlowMo, and Generate are all
 * locked until the first two steps are done. Pressing Trim and SlowMo swaps the
 * guide to trim instructions.
 */

const exportContainerSpy = vi.fn(() => ({}));

vi.mock('../components/AspectRatioSelector', () => ({ default: () => <div /> }));
vi.mock('../components/VideoPlayer', () => ({
  VideoPlayer: ({ overlays }) => <div>{overlays}</div>,
}));
// T12750: the stubs read the REAL GuideScope via useGuidePulse (the join the controls make);
// each control's own test proves it consumes the same target.
vi.mock('../components/Controls', async () => {
  const { useGuidePulse } = await import('../components/instructions/GuideScope');
  const { GUIDE_PULSE } = await import('../components/instructions/guideTargets');
  return {
    Controls: function ControlsStub({ onTogglePlay }) {
      return <button data-testid="play" data-pulse={String(!!useGuidePulse(GUIDE_PULSE.PLAY))} onClick={onTogglePlay} />;
    },
  };
});
vi.mock('../components/ZoomControls', () => ({ default: () => <div /> }));
vi.mock('../components/ExportButtonView', async () => {
  const { useGuidePulse } = await import('../components/instructions/GuideScope');
  const { GUIDE_PULSE } = await import('../components/instructions/guideTargets');
  return {
    default: function ExportStub({ actionsAbove }) {
      return <div><button data-testid="generate" data-pulse={String(!!useGuidePulse(GUIDE_PULSE.EXPORT))} />{actionsAbove}</div>;
    },
  };
});
vi.mock('../containers/ExportButtonContainer', () => ({
  ExportButtonContainer: (args) => exportContainerSpy(args),
  HIGHLIGHT_EFFECT_LABELS: {},
  EXPORT_CONFIG: {},
}));
vi.mock('../components/shared', async () => {
  const { useGuidePulse } = await import('../components/instructions/GuideScope');
  return {
  Button: function ButtonStub({ children, guideTarget, title, onClick, ...rest }) {
    return <button data-testid={rest['data-testid']} title={title} onClick={onClick} data-pulse={String(!!useGuidePulse(guideTarget))}>{children}</button>;
  },
  Toggle: ({ checked, onChange }) => (
    <button role="switch" aria-checked={checked} onClick={() => onChange?.(!checked)} />
  ),
  };
});
vi.mock('../components/shared/clipConstants', () => ({ DEFAULT_CLIP_BEFORE: 6, DEFAULT_CLIP_AFTER: 2, formatTimeSimple: () => '0:00' }));
// Stands in for SegmentLayer: reads the real GuideScope exactly as its track and buttons do.
vi.mock('./focus/FocusTimelineBlock', async () => {
  const { useGuidePulse } = await import('../components/instructions/GuideScope');
  const { GUIDE_PULSE } = await import('../components/instructions/guideTargets');
  return {
    FocusTimelineBlock: function TrimStub() {
      return (
        <div>
          <div data-testid="trim-track" data-pulse={String(!!useGuidePulse(GUIDE_PULSE.TRIM_TRACK))} />
          <button data-testid="trim-adjust" data-pulse={String(!!useGuidePulse(GUIDE_PULSE.TRIM_ADJUST))} />
        </div>
      );
    },
  };
});
vi.mock('./focus', async () => {
  const { useGuidePulse } = await import('../components/instructions/GuideScope');
  const { GUIDE_PULSE } = await import('../components/instructions/guideTargets');
  return {
    FocusMode: () => <div />,
    CropOverlay: function CropOverlayStub({ onCropComplete }) {
      return (
        <button
          data-testid="crop-box"
          data-pulse={String(!!useGuidePulse(GUIDE_PULSE.CROP_BOX))}
          onClick={() => onCropComplete({ x: 0, y: 0, width: 10, height: 10 })}
        />
      );
    },
  };
});
vi.mock('../hooks/useIsMobile', () => ({ useIsMobile: () => false }));
vi.mock('../hooks/useFullscreenControls', () => ({
  useFullscreenControls: () => ({
    isVisible: true,
    handleInteraction: () => {},
    handleLongPressTouchStart: () => {},
    handleLongPressTouchMove: () => {},
    handleLongPressTouchEnd: () => {},
  }),
}));

const jobStatusMock = vi.hoisted(() => ({ status: 'none' }));
vi.mock('../components/instructions/exportJob', async (orig) => ({ ...(await orig()), useExportJobStatus: () => jobStatusMock.status }));

import { FocusModeView } from './FocusModeView';


function baseProps() {
  return {
    videoRef: { current: null },
    videoUrl: 'blob:video',
    metadata: { width: 1920, height: 1080, framerate: 30 },
    currentCropState: { x: 0, y: 0, width: 100, height: 100 },
    isFullscreen: false,
    handlers: {},
    aspectRatio: '9:16',
    globalAspectRatio: '9:16',
    onAspectRatioChange: vi.fn(),
    onCropComplete: vi.fn(),
    togglePlay: vi.fn(),
    isPlaying: false,
    keyframes: [],
    segmentBoundaries: [0, 10],
    clipsWithCurrentState: [],
    getTimelineScale: () => 1,
    getSegmentExportData: () => ({}),
    getFilteredKeyframesForExport: () => [],
  };
}


// T12790: Focus went silent when its video failed to load (the guide needed videoUrl) and in
// fullscreen (the floating card was not mounted there at all).
const kf = (frame, origin = 'user') => ({ frame, x: 0, y: 0, width: 100, height: 100, origin });
const Harness = (p) => <FocusModeView {...baseProps()} {...p} />;

describe('FocusModeView guide on video error and in fullscreen (T12790)', () => {
  beforeEach(() => useSettingsStore.setState((st) => ({ settings: { ...st.settings, guidance: { ...st.settings.guidance, coachEnabled: true } } })));

  it('a failed load with Retry says to retry and pulses it', () => {
    render(<Harness videoUrl={null} error="Video link expired" isUrlExpiredError={() => true} onRetryVideo={vi.fn()} />);
    expect(screen.getByTestId('framing-guide-text').textContent).toBe(GUIDE.focus.videoErrorRetry);
    expect(screen.getByTestId('focus-video-retry').dataset.pulse).toBe('true');
  });

  it('a failed load without Retry still says what to do', () => {
    render(<Harness videoUrl={null} error="Could not decode video" />);
    expect(screen.getByTestId('framing-guide-text').textContent).toBe(GUIDE.focus.videoError);
  });

  it('fullscreen shows the step in the compact strip', () => {
    render(<Harness isFullscreen />);
    expect(screen.getByTestId('focus-fullscreen-guide-text').textContent).toBe(GUIDE.focus.drag);
  });

  it('fullscreen past the stage steps says to exit fullscreen and pulses the exit button', () => {
    const { rerender } = render(<Harness isFullscreen keyframes={[kf(10)]} />);
    rerender(<Harness isFullscreen keyframes={[kf(10)]} isPlaying />);
    rerender(<Harness isFullscreen keyframes={[kf(10)]} isPlaying clipDuration={6} currentTime={5.9} />);
    expect(screen.getByTestId('focus-fullscreen-guide-text').textContent).toBe(GUIDE.focus.leaveFullscreen);
    expect(screen.getByTitle('Exit fullscreen (Esc)').dataset.pulse).toBe('true');
  });
});

describe('FocusModeView fullscreen export states (T12790 review)', () => {
  beforeEach(() => useSettingsStore.setState((st) => ({ settings: { ...st.settings, guidance: { ...st.settings.guidance, coachEnabled: true } } })));
  afterEach(() => { jobStatusMock.status = 'none'; });

  it('a failed export in fullscreen points out of fullscreen, not at the hidden Generate button', () => {
    jobStatusMock.status = 'failed';
    render(<Harness isFullscreen keyframes={[kf(10)]} />);
    expect(screen.getByTestId('focus-fullscreen-guide-text').textContent).toBe(GUIDE.focus.leaveFullscreenJob);
    expect(screen.getByTitle('Exit fullscreen (Esc)').dataset.pulse).toBe('true');
  });

  it('a running export in fullscreen still shows progress', () => {
    jobStatusMock.status = 'processing';
    render(<Harness isFullscreen keyframes={[kf(10)]} />);
    expect(screen.getByTestId('focus-fullscreen-guide-text').textContent).toBe(GUIDE.focus.progressExport);
  });
});
