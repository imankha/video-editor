import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NoSportTagWarning } from '../NoSportTagWarning';

// T7922: the full variant of the no_sport Tags prompt is now ACTIONABLE — it
// renders an inline sport picker (the shared InlineSportSelect) so a first-time
// mobile user can set their sport and get tags without leaving the Add Clip
// form. The compact (landscape scrub-bar) variant is DEFERRED to a fast-follow
// and must stay the non-interactive instructional prose (T7922 founder scope).

describe('NoSportTagWarning — full variant is an inline sport picker (T7922)', () => {
  it('renders the inline sport picker and fires onChange with the picked sport', () => {
    const onChange = vi.fn();
    render(<NoSportTagWarning onChange={onChange} />);

    // The shared InlineSportSelect exposes a native <select> labelled "Change sport".
    const select = screen.getByRole('combobox', { name: /change sport/i });
    expect(select).toBeTruthy();

    fireEvent.change(select, { target: { value: 'soccer' } });
    expect(onChange).toHaveBeenCalledWith('soccer');
  });

  it('does NOT offer the "Other..." free-text option (no onPickOther in this context)', () => {
    render(<NoSportTagWarning onChange={vi.fn()} />);
    // "Other..." routes to a full modal that cannot render over the z-[100]
    // fullscreen annotate overlay and yields no tags anyway — omitted here.
    expect(screen.queryByRole('option', { name: /other/i })).toBeNull();
  });
});

describe('NoSportTagWarning — compact variant stays instructional (T7922 deferral)', () => {
  it('renders the non-interactive top-bar prose and no picker', () => {
    render(<NoSportTagWarning compact onChange={vi.fn()} />);
    expect(screen.getByText(/Set your sport \(top bar\) for tags/i)).toBeTruthy();
    expect(screen.queryByRole('combobox')).toBeNull();
  });
});
