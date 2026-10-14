import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GuideScope, useGuidePulse } from './GuideScope';
import { GUIDE_PULSE, GUIDE_PULSE_CLASS } from './guideTargets';
import { useSettingsStore } from '../../stores/settingsStore';

function Probe({ target, suppress, id = 'probe' }) {
  const cls = useGuidePulse(target, { suppress });
  return <button data-testid={id} className={cls} />;
}
const setCoach = (coachEnabled) => useSettingsStore.setState((s) => ({
  settings: { ...s.settings, guidance: { ...s.settings.guidance, coachEnabled } },
}));

describe('T12730 GuideScope / useGuidePulse', () => {
  beforeEach(() => setCoach(true));

  it('pulses the control named by the scope guide when Guidance is on', () => {
    render(<GuideScope guides={[{ pulse: GUIDE_PULSE.PLAY }]}><Probe target={GUIDE_PULSE.PLAY} /></GuideScope>);
    expect(screen.getByTestId('probe').className).toBe(GUIDE_PULSE_CLASS);
  });
  it('pulses nothing when Guidance is off', () => {
    setCoach(false);
    render(<GuideScope guides={[{ pulse: GUIDE_PULSE.PLAY }]}><Probe target={GUIDE_PULSE.PLAY} /></GuideScope>);
    expect(screen.getByTestId('probe').className).toBe('');
  });
  it('pulses nothing outside any scope, for a different target, or when suppressed', () => {
    render(<Probe target={GUIDE_PULSE.PLAY} id="bare" />);
    expect(screen.getByTestId('bare').className).toBe('');
    render(<GuideScope guides={[{ pulse: GUIDE_PULSE.PLAY }]}>
      <Probe target={GUIDE_PULSE.EXPORT} id="other" /><Probe target={GUIDE_PULSE.PLAY} suppress id="busy" />
    </GuideScope>);
    expect(screen.getByTestId('other').className).toBe('');
    expect(screen.getByTestId('busy').className).toBe('');
  });
  it('a null guide pulses nothing; several guides union their targets; arrays match any', () => {
    render(<GuideScope guides={[null, { pulse: GUIDE_PULSE.PICK_BOX }, { pulse: GUIDE_PULSE.EXPORT }]}>
      <Probe target={GUIDE_PULSE.PICK_BOX} id="a" /><Probe target={GUIDE_PULSE.EXPORT} id="b" />
      <Probe target={[GUIDE_PULSE.PLAY, GUIDE_PULSE.EXPORT]} id="c" /><Probe target={GUIDE_PULSE.PLAY} id="d" />
    </GuideScope>);
    expect(['a', 'b', 'c', 'd'].map((i) => screen.getByTestId(i).className)).toEqual([GUIDE_PULSE_CLASS, GUIDE_PULSE_CLASS, GUIDE_PULSE_CLASS, '']);
  });
  it('the innermost scope wins', () => {
    render(<GuideScope guides={[{ pulse: GUIDE_PULSE.PLAY }]}>
      <GuideScope guides={[{ pulse: null }]}><Probe target={GUIDE_PULSE.PLAY} /></GuideScope>
    </GuideScope>);
    expect(screen.getByTestId('probe').className).toBe('');
  });
});
