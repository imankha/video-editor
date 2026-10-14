import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HighlightOrientationSlots } from './HighlightOrientationSlots';
import { GuideScope } from '../../../components/instructions/GuideScope';
import { GUIDE_PULSE, GUIDE_PULSE_CLASS } from '../../../components/instructions/guideTargets';
import { useSettingsStore } from '../../../stores/settingsStore';

const setCoach = (coachEnabled) => useSettingsStore.setState((s) => ({
  settings: { ...s.settings, guidance: { ...s.settings.guidance, coachEnabled } },
}));
const renderSlots = (pending = false, pulse = GUIDE_PULSE.PORTRAIT_SLOT) => render(
  <GuideScope guides={[{ pulse }]}>
    <HighlightOrientationSlots instances={[]} pending={pending} onMake={vi.fn()} onOpen={vi.fn()} inline />
  </GuideScope>,
);

describe('T12740 HighlightOrientationSlots pulse via GuideScope', () => {
  beforeEach(() => setCoach(true));

  it('pulses only the portrait slot when the guide targets it', () => {
    renderSlots();
    expect(screen.getByTestId('annotate-highlight-slot-portrait').className).toContain(GUIDE_PULSE_CLASS);
    expect(screen.getByTestId('annotate-highlight-slot-landscape').className).not.toContain(GUIDE_PULSE_CLASS);
  });
  it('does not pulse while pending, with another target, or with Guidance off', () => {
    renderSlots(true);
    expect(screen.getByTestId('annotate-highlight-slot-portrait').className).not.toContain(GUIDE_PULSE_CLASS);
  });
  it('Guidance off pulses nothing', () => {
    setCoach(false);
    renderSlots();
    expect(screen.getByTestId('annotate-highlight-slot-portrait').className).not.toContain(GUIDE_PULSE_CLASS);
  });
  it('another target pulses nothing', () => {
    renderSlots(false, GUIDE_PULSE.MARK_PLAY);
    expect(screen.getByTestId('annotate-highlight-slot-portrait').className).not.toContain(GUIDE_PULSE_CLASS);
  });
});
