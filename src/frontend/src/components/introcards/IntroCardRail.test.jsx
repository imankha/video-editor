// T5205 / T6640 — the editor rail: facts drive composition, treatment is
// independent, unfilled facts prompt inline, subtitle is content (not
// styling), and NO control here can produce a font/colour clash (decision 12
// removed the per-slot styling editor entirely).

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { IntroCardRail } from './IntroCardRail';

afterEach(cleanup);

function renderRail(overrides = {}) {
  const props = {
    card: { id: 1, name: 'C', treatment: 'gold', shown_fields: [], image_key: null },
    profile: { id: 'p', position: '', class: '', team: '' },
    onToggleFact: vi.fn(),
    onSetTreatment: vi.fn(),
    onCommitSubtitle: vi.fn(),
    onImageChanged: vi.fn(),
    onEditProfile: vi.fn(),
    onError: vi.fn(),
    ...overrides,
  };
  render(<IntroCardRail {...props} />);
  return props;
}

describe('IntroCardRail', () => {
  it('ticking a fact calls onToggleFact (the composition axis)', () => {
    const props = renderRail();
    fireEvent.click(screen.getByLabelText('Position'));
    expect(props.onToggleFact).toHaveBeenCalledWith('position');
  });

  it('a shown fact with no profile value prompts to add it, linking back to the profile', () => {
    const props = renderRail({
      card: { id: 1, name: 'C', treatment: 'gold', shown_fields: ['team'], image_key: null },
    });
    const addButtons = screen.getAllByText('Add it');
    expect(addButtons.length).toBeGreaterThan(0);
    fireEvent.click(addButtons[0]);
    expect(props.onEditProfile).toHaveBeenCalled();
  });

  it('choosing a treatment calls onSetTreatment and never touches facts', () => {
    const props = renderRail();
    fireEvent.click(screen.getByRole('button', { name: 'Dark' }));
    expect(props.onSetTreatment).toHaveBeenCalledWith('dark');
    expect(props.onToggleFact).not.toHaveBeenCalled();
  });

  it('shows the public-exposure notice', () => {
    renderRail();
    expect(screen.getByText(/Anyone with the share link can see this card/i)).toBeTruthy();
  });

  it('typing a subtitle and blurring calls onCommitSubtitle (content, not styling)', () => {
    const props = renderRail();
    const input = screen.getByPlaceholderText('e.g. State Cup 2027');
    fireEvent.change(input, { target: { value: 'State Cup 2027' } });
    fireEvent.blur(input);
    expect(props.onCommitSubtitle).toHaveBeenCalledWith('State Cup 2027');
  });

  it('T6650: a broken card photo shows a visible "photo missing" state (not a silent broken img)', () => {
    renderRail({
      card: { id: 1, name: 'C', treatment: 'gold', shown_fields: [], image_key: 'k', previewUrl: 'http://dead' },
      profile: { id: 'p', introPhotoKey: 'k', introPhotoUrl: 'http://profile' },
    });
    // The <img> renders first; simulate its load failure.
    const img = screen.getByAltText('Card');
    fireEvent.error(img);
    expect(screen.getByTestId('card-photo-missing')).toBeTruthy();
    expect(screen.getByText(/photo is no longer available/i)).toBeTruthy();
  });

  it('T6650: a broken card photo un-gates "Use profile photo" so it refreshes in place (no Remove first)', () => {
    const props = renderRail({
      card: { id: 1, name: 'C', treatment: 'gold', shown_fields: [], image_key: 'k', previewUrl: 'http://dead' },
      profile: { id: 'p', introPhotoKey: 'kp', introPhotoUrl: 'http://profile' },
    });
    // Healthy hasPhoto card does NOT offer the recovery button...
    expect(screen.queryByText('Use profile photo')).toBeNull();
    // ...but once the photo fails to load it appears in place.
    fireEvent.error(screen.getByAltText('Card'));
    const btn = screen.getByText('Use profile photo');
    fireEvent.click(btn);
    expect(props.onImageChanged).toHaveBeenCalledWith('kp', 'http://profile');
  });

  it('T6640: exposes no font, colour or effects control (template owns all typography)', () => {
    renderRail();
    expect(screen.queryByText('Font')).toBeNull();
    expect(screen.queryByLabelText('Custom color')).toBeNull();
    expect(screen.queryByLabelText('Shadow blur')).toBeNull();
    expect(screen.queryByLabelText('Stroke width')).toBeNull();
    expect(screen.queryByLabelText('Size')).toBeNull();
    expect(screen.queryByLabelText('Align')).toBeNull();
  });
});
