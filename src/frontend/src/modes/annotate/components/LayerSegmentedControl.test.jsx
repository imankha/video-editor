import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LayerSegmentedControl } from './LayerSegmentedControl';

// T5700: the one-layer-per-clip control shared by the mode toggle, the desktop
// per-clip control, and the mobile per-clip control.
describe('LayerSegmentedControl', () => {
  it('shows My Athlete selected when value is true, null, or undefined (legacy rule)', () => {
    for (const value of [true, null, undefined]) {
      const { unmount } = render(<LayerSegmentedControl value={value} onChange={() => {}} />);
      expect(screen.getByRole('radio', { name: 'My Athlete layer' }).getAttribute('aria-checked')).toBe('true');
      expect(screen.getByRole('radio', { name: 'Team layer' }).getAttribute('aria-checked')).toBe('false');
      unmount();
    }
  });

  it('shows Team selected when value is false', () => {
    render(<LayerSegmentedControl value={false} onChange={() => {}} />);
    expect(screen.getByRole('radio', { name: 'My Athlete layer' }).getAttribute('aria-checked')).toBe('false');
    expect(screen.getByRole('radio', { name: 'Team layer' }).getAttribute('aria-checked')).toBe('true');
  });

  it('calls onChange(false) when Team is clicked and onChange(true) when My Athlete is clicked', () => {
    const onChange = vi.fn();
    render(<LayerSegmentedControl value={true} onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Team layer' }));
    expect(onChange).toHaveBeenCalledWith(false);

    onChange.mockClear();
    fireEvent.click(screen.getByRole('radio', { name: 'My Athlete layer' }));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('is a radiogroup of two mutually exclusive radios', () => {
    render(<LayerSegmentedControl value={true} onChange={() => {}} />);
    expect(screen.getByRole('radiogroup')).toBeTruthy();
    expect(screen.getAllByRole('radio')).toHaveLength(2);
  });

  describe('disabled (imported clip lock)', () => {
    it('disables both segments and does not fire onChange when clicked', () => {
      const onChange = vi.fn();
      render(
        <LayerSegmentedControl
          value={false}
          onChange={onChange}
          disabled
          disabledReason="Shared by Dana — imported clips stay on the Team layer"
        />
      );
      const mine = screen.getByRole('radio', { name: /^My Athlete layer/ });
      const team = screen.getByRole('radio', { name: /^Team layer/ });
      expect(mine.disabled).toBe(true);
      expect(team.disabled).toBe(true);

      fireEvent.click(mine);
      fireEvent.click(team);
      expect(onChange).not.toHaveBeenCalled();
    });

    it('exposes the reason via title and aria-label, not just visually', () => {
      render(
        <LayerSegmentedControl
          value={false}
          onChange={() => {}}
          disabled
          disabledReason="Shared by Dana — imported clips stay on the Team layer"
        />
      );
      const team = screen.getByRole('radio', { name: /^Team layer — Shared by Dana/ });
      expect(team.getAttribute('title')).toContain('Shared by Dana');
      expect(screen.getByRole('radiogroup').getAttribute('title')).toContain('Shared by Dana');
    });
  });
});
