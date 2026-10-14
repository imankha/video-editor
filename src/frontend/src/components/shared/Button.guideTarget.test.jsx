import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Button } from './Button';
import { GuideScope } from '../instructions/GuideScope';
import { GUIDE_PULSE, GUIDE_PULSE_CLASS } from '../instructions/guideTargets';
import { useSettingsStore } from '../../stores/settingsStore';

const setCoach = (coachEnabled) => useSettingsStore.setState((s) => ({
  settings: { ...s.settings, guidance: { ...s.settings.guidance, coachEnabled } },
}));
const scope = (children) => <GuideScope guides={[{ pulse: GUIDE_PULSE.UPLOAD_GAME }]}>{children}</GuideScope>;

describe('T12740 Button guideTarget', () => {
  beforeEach(() => setCoach(true));

  it('pulses when its target is the scope guide pulse', () => {
    render(scope(<Button guideTarget={GUIDE_PULSE.UPLOAD_GAME} data-testid="b">Upload</Button>));
    expect(screen.getByTestId('b').className).toContain(GUIDE_PULSE_CLASS);
  });
  it('does not pulse for another target, without a target, or with Guidance off', () => {
    render(scope(<>
      <Button guideTarget={GUIDE_PULSE.PLAY} data-testid="other">x</Button>
      <Button data-testid="plain">x</Button>
    </>));
    expect(screen.getByTestId('other').className).not.toContain(GUIDE_PULSE_CLASS);
    expect(screen.getByTestId('plain').className).not.toContain(GUIDE_PULSE_CLASS);
    setCoach(false);
    render(scope(<Button guideTarget={GUIDE_PULSE.UPLOAD_GAME} data-testid="off">x</Button>));
    expect(screen.getByTestId('off').className).not.toContain(GUIDE_PULSE_CLASS);
  });
  it('is suppressed while disabled or loading, and never leaks to the DOM', () => {
    render(scope(<>
      <Button guideTarget={GUIDE_PULSE.UPLOAD_GAME} disabled data-testid="dis">x</Button>
      <Button guideTarget={GUIDE_PULSE.UPLOAD_GAME} loading data-testid="load">x</Button>
      <Button guideTarget={GUIDE_PULSE.UPLOAD_GAME} data-testid="ok">x</Button>
    </>));
    expect(screen.getByTestId('dis').className).not.toContain(GUIDE_PULSE_CLASS);
    expect(screen.getByTestId('load').className).not.toContain(GUIDE_PULSE_CLASS);
    expect(screen.getByTestId('ok').hasAttribute('guidetarget')).toBe(false);
  });
});
