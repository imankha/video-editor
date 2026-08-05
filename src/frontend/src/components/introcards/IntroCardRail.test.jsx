// T5205 — the editor rail: facts drive composition, treatment is independent,
// unfilled facts prompt inline, and styling routes through the shared editor.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { IntroCardRail } from './IntroCardRail';
import { defaultSlotSpec } from './introCardDefaults';

afterEach(cleanup);

function renderRail(overrides = {}) {
  const props = {
    card: { id: 1, name: 'C', treatment: 'gold', shown_fields: [], title_text: 'HI', text_elements: {}, image_key: null },
    profile: { id: 'p', position: '', class: '', team: '' },
    selectedSlot: 'title',
    onSelectSlot: vi.fn(),
    onToggleFact: vi.fn(),
    onSetTreatment: vi.fn(),
    onCommitTitle: vi.fn(),
    specForSlot: (slot) => defaultSlotSpec(slot),
    onUpdateSlotSpec: vi.fn(),
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
      card: { id: 1, name: 'C', treatment: 'gold', shown_fields: ['team'], title_text: 'HI', text_elements: {}, image_key: null },
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

  it('editing styling routes through onUpdateSlotSpec for the selected slot', () => {
    const props = renderRail();
    // The title slot is selected; changing size (a preset) emits a styling update.
    fireEvent.click(screen.getByLabelText('Size L'));
    expect(props.onUpdateSlotSpec).toHaveBeenCalled();
    expect(props.onUpdateSlotSpec.mock.calls.at(-1)[0]).toBe('title');
  });
});
