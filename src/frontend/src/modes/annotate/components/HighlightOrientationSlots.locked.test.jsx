import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HighlightEntry } from './HighlightOrientationSlots';
import { GuideScope } from '../../../components/instructions/GuideScope';
import { GUIDE_PULSE, GUIDE_PULSE_CLASS } from '../../../components/instructions/guideTargets';
import { useSettingsStore } from '../../../stores/settingsStore';
import { ANNOTATE } from '../../../config/displayNames';

// While the game is still uploading its source isn't in storage, so no highlight
// can be made from it: the entry button is locked and says why.
describe('HighlightEntry locked (game still uploading)', () => {
  beforeEach(() => useSettingsStore.setState((s) => ({
    settings: { ...s.settings, guidance: { ...s.settings.guidance, coachEnabled: true } },
  })));

  const renderLocked = () => {
    const onMake = vi.fn();
    render(
      <GuideScope guides={[{ pulse: GUIDE_PULSE.MAKE_HIGHLIGHT }]}>
        <HighlightEntry pending={false} locked onMake={onMake} />
      </GuideScope>,
    );
    return { onMake };
  };

  it('disables the Make highlight button and ignores taps', () => {
    const { onMake } = renderLocked();
    expect(screen.getByTestId('annotate-make-highlight').disabled).toBe(true);
    fireEvent.click(screen.getByTestId('annotate-make-highlight'));
    expect(onMake).not.toHaveBeenCalled();
  });

  it('says highlights unlock when the upload finishes, and never pulses', () => {
    renderLocked();
    expect(screen.getByText(ANNOTATE.HIGHLIGHT_AFTER_UPLOAD)).toBeTruthy();
    expect(screen.getByTestId('annotate-make-highlight').className).not.toContain(GUIDE_PULSE_CLASS);
  });
});
