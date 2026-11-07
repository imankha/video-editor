import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HighlightEntry, HighlightList } from './HighlightOrientationSlots';
import { GuideScope } from '../../../components/instructions/GuideScope';
import { GUIDE_PULSE, GUIDE_PULSE_CLASS } from '../../../components/instructions/guideTargets';
import { useSettingsStore } from '../../../stores/settingsStore';

const setCoach = (coachEnabled) => useSettingsStore.setState((s) => ({
  settings: { ...s.settings, guidance: { ...s.settings.guidance, coachEnabled } },
}));
const renderEntry = (pending = false, pulse = GUIDE_PULSE.MAKE_HIGHLIGHT) => render(
  <GuideScope guides={[{ pulse }]}>
    <HighlightEntry pending={pending} onMake={vi.fn()} />
  </GuideScope>,
);

describe('T14770 HighlightEntry pulse via GuideScope', () => {
  beforeEach(() => setCoach(true));

  it('pulses the entry button when the guide targets it', () => {
    renderEntry();
    expect(screen.getByTestId('annotate-make-highlight').className).toContain(GUIDE_PULSE_CLASS);
  });
  it('does not pulse while pending, with another target, or with Guidance off', () => {
    renderEntry(true);
    expect(screen.getByTestId('annotate-make-highlight').className).not.toContain(GUIDE_PULSE_CLASS);
  });
  it('Guidance off pulses nothing', () => {
    setCoach(false);
    renderEntry();
    expect(screen.getByTestId('annotate-make-highlight').className).not.toContain(GUIDE_PULSE_CLASS);
  });
  it('another target pulses nothing', () => {
    renderEntry(false, GUIDE_PULSE.MARK_PLAY);
    expect(screen.getByTestId('annotate-make-highlight').className).not.toContain(GUIDE_PULSE_CLASS);
  });
});

describe('T14770 HighlightList row pulse via GuideScope', () => {
  beforeEach(() => setCoach(true));

  const instances = [
    { projectId: 1, orientation: 'portrait', ordinal: 1, stage: 'FOCUS', stale: false },
    { projectId: 2, orientation: 'landscape', ordinal: 1, stage: 'FOCUS', stale: false },
  ];

  it('pulses only the row matching highlightedProjectId', () => {
    render(
      <GuideScope guides={[{ pulse: GUIDE_PULSE.HIGHLIGHT_ROW }]}>
        <HighlightList instances={instances} onOpen={vi.fn()} highlightedProjectId={1} />
      </GuideScope>,
    );
    expect(screen.getByTestId('highlight-row-1').className).toContain(GUIDE_PULSE_CLASS);
    expect(screen.getByTestId('highlight-row-2').className).not.toContain(GUIDE_PULSE_CLASS);
  });

  it('pulses no row when nothing is tracked', () => {
    render(
      <GuideScope guides={[{ pulse: GUIDE_PULSE.HIGHLIGHT_ROW }]}>
        <HighlightList instances={instances} onOpen={vi.fn()} />
      </GuideScope>,
    );
    expect(screen.getByTestId('highlight-row-1').className).not.toContain(GUIDE_PULSE_CLASS);
    expect(screen.getByTestId('highlight-row-2').className).not.toContain(GUIDE_PULSE_CLASS);
  });
});
