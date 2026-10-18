import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HighlightOrientationSlots } from './HighlightOrientationSlots';
import { GuideScope } from '../../../components/instructions/GuideScope';
import { GUIDE_PULSE, GUIDE_PULSE_CLASS } from '../../../components/instructions/guideTargets';
import { useSettingsStore } from '../../../stores/settingsStore';
import { ANNOTATE } from '../../../config/displayNames';

// While the game is still uploading its source isn't in storage, so no highlight
// can be made or opened from it: both slots are locked and say why.
describe('HighlightOrientationSlots locked (game still uploading)', () => {
  beforeEach(() => useSettingsStore.setState((s) => ({
    settings: { ...s.settings, guidance: { ...s.settings.guidance, coachEnabled: true } },
  })));

  const renderLocked = (instances = []) => {
    const onMake = vi.fn();
    const onOpen = vi.fn();
    render(
      <GuideScope guides={[{ pulse: GUIDE_PULSE.HIGHLIGHT_SLOT }]}>
        <HighlightOrientationSlots instances={instances} pending={false} locked onMake={onMake} onOpen={onOpen} />
      </GuideScope>,
    );
    return { onMake, onOpen };
  };

  it('disables both Make buttons and ignores taps on the slot cards', () => {
    const { onMake } = renderLocked();
    for (const o of ['portrait', 'landscape']) {
      expect(screen.getByTestId(`annotate-make-highlight-${o}`).disabled).toBe(true);
      fireEvent.click(screen.getByTestId(`annotate-make-highlight-${o}`));
      fireEvent.click(screen.getByTestId(`annotate-highlight-slot-${o}`));
    }
    expect(onMake).not.toHaveBeenCalled();
  });

  it('says highlights unlock when the upload finishes, and never pulses', () => {
    renderLocked();
    expect(screen.getAllByText(ANNOTATE.HIGHLIGHT_AFTER_UPLOAD)).toHaveLength(2);
    expect(screen.getByTestId('annotate-highlight-slot-portrait').className).not.toContain(GUIDE_PULSE_CLASS);
    expect(screen.getByTestId('annotate-highlight-slot-landscape').className).not.toContain(GUIDE_PULSE_CLASS);
  });
});
