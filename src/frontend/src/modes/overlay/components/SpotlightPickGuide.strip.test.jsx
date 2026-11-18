import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import SpotlightPickGuide from './SpotlightPickGuide';
import { useSettingsStore } from '../../../stores/settingsStore';

// T17180: on a phone the tap walk is a one-line strip ABOVE the video ("Tap your athlete, 1 of 4"),
// in the page flow, so no part of it can sit over the athletes it asks the parent to tap.
beforeEach(() => { useSettingsStore.getState().setFromBootstrap({ guidance: { coachEnabled: true } }); });

describe('SpotlightPickGuide strip (T17180)', () => {
  it('renders one line in place, not a floating card over the video', () => {
    render(<div data-testid="slot"><SpotlightPickGuide strip phase="parked" step={1} total={4} assignedCount={0} /></div>);
    const guide = screen.getByTestId('spotlight-pick-guide');
    expect(screen.getByTestId('slot').contains(guide)).toBe(true);
    expect(guide.dataset.variant).toBe('strip');
    expect(screen.queryByTestId('floating-coach-host')).toBeNull();
    expect(screen.queryByTestId('guide-shade')).toBeNull();
    expect(screen.getByTestId('pick-guide-text').textContent).toBe('Tap your athlete, 1 of 4');
  });

  it('keeps "My athlete isn\'t outlined" reachable as a small text button', () => {
    const onNotBoxed = vi.fn();
    render(<SpotlightPickGuide strip phase="parked" step={2} total={4} assignedCount={1} boxed onNotBoxed={onNotBoxed} />);
    const notBoxed = screen.getByTestId('pick-guide-not-boxed');
    expect(notBoxed.textContent).toBe("My athlete isn't outlined");
    fireEvent.click(notBoxed);
    expect(onNotBoxed).toHaveBeenCalled();
  });
});
