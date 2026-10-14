import { useRef } from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Controls } from './Controls';
import PrimaryCta from './PrimaryCta';
import CtaBar from './shared/CtaBar';
import FramingActionRow from '../modes/focus/FramingActionRow';
import PlayerDetectionOverlay from '../modes/overlay/overlays/PlayerDetectionOverlay';
import { GuideScope } from './instructions/GuideScope';
import { GUIDE_PULSE, GUIDE_PULSE_CLASS } from './instructions/guideTargets';
import { useSettingsStore } from '../stores/settingsStore';

// T12750: Focus + Overlay controls pulse because the screen's GuideScope names their target,
// not because a pulse* prop was threaded to them.
const setCoach = (coachEnabled) => useSettingsStore.setState((s) => ({
  settings: { ...s.settings, guidance: { ...s.settings.guidance, coachEnabled } },
}));
const scope = (pulse, children) => <GuideScope guides={[{ pulse }]}>{children}</GuideScope>;
const pulses = (el) => el.className.includes(GUIDE_PULSE_CLASS);

function Detections() {
  const videoRef = useRef(null);
  return (
    <div className="video-container" style={{ width: 560, height: 320 }}>
      <video ref={videoRef} />
      <PlayerDetectionOverlay
        videoRef={videoRef}
        videoMetadata={{ width: 560, height: 320 }}
        detections={[{ x: 150, y: 170, width: 90, height: 200, confidence: 0.7 }]}
        detectionVideoWidth={560}
        detectionVideoHeight={320}
        panOffset={{ x: 0, y: 0 }}
      />
    </div>
  );
}

describe('T12750 Focus/Overlay controls consume GuideScope targets', () => {
  beforeEach(() => setCoach(true));

  it('Controls play button pulses for PLAY only, off with Guidance off', () => {
    const { unmount } = render(scope(GUIDE_PULSE.PLAY, <Controls />));
    expect(pulses(screen.getByTestId('play-button'))).toBe(true);
    unmount();
    render(scope(GUIDE_PULSE.PREVIEW, <Controls />));
    expect(pulses(screen.getByTestId('play-button'))).toBe(false);
  });

  it('Controls play button does not pulse with Guidance off', () => {
    setCoach(false);
    render(scope(GUIDE_PULSE.PLAY, <Controls />));
    expect(pulses(screen.getByTestId('play-button'))).toBe(false);
  });

  it('FramingActionRow preview pulses for PREVIEW, not while previewing or locked', () => {
    const { unmount } = render(scope(GUIDE_PULSE.PREVIEW, <FramingActionRow onTogglePreview={() => {}} />));
    expect(pulses(screen.getByTestId('framing-preview-toggle'))).toBe(true);
    unmount();
    const r2 = render(scope(GUIDE_PULSE.PREVIEW, <FramingActionRow onTogglePreview={() => {}} previewing />));
    expect(pulses(screen.getByTestId('framing-preview-toggle'))).toBe(false);
    r2.unmount();
    render(scope(GUIDE_PULSE.PREVIEW, <FramingActionRow onTogglePreview={() => {}} locked />));
    expect(pulses(screen.getByTestId('framing-preview-toggle'))).toBe(false);
  });

  it('PrimaryCta pulses for its guideTarget, not when disabled', () => {
    const { unmount } = render(scope(GUIDE_PULSE.EXPORT, <PrimaryCta guideTarget={GUIDE_PULSE.EXPORT}>Go</PrimaryCta>));
    expect(pulses(screen.getByTestId('primary-cta'))).toBe(true);
    unmount();
    render(scope(GUIDE_PULSE.EXPORT, <PrimaryCta guideTarget={GUIDE_PULSE.EXPORT} disabled>Go</PrimaryCta>));
    expect(pulses(screen.getByTestId('primary-cta'))).toBe(false);
  });

  it('CtaBar action guideTarget pulses from the scope, not when locked', () => {
    const action = { title: 'Do it', testId: 'cta-a', guideTarget: GUIDE_PULSE.EXPORT, onClick: () => {} };
    const { unmount } = render(scope(GUIDE_PULSE.EXPORT, <CtaBar primary={action} />));
    expect(pulses(screen.getByTestId('cta-a'))).toBe(true);
    unmount();
    render(scope(GUIDE_PULSE.EXPORT, <CtaBar primary={{ ...action, lockedReason: 'nope' }} />));
    expect(pulses(screen.getByTestId('cta-a'))).toBe(false);
  });

  it('PlayerDetectionOverlay halos come from the PICK_BOX scope target', () => {
    const { container, unmount } = render(scope(GUIDE_PULSE.PICK_BOX, <Detections />));
    expect(container.querySelectorAll('[data-testid="pick-box-pulse"]').length).toBe(1);
    unmount();
    const r2 = render(scope(null, <Detections />));
    expect(r2.container.querySelectorAll('[data-testid="pick-box-pulse"]').length).toBe(0);
  });
});
