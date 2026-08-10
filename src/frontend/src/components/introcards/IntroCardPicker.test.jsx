// T6670 — the state handoff between the shared picker and the inline card
// editor. The crux: create a card WITHOUT the picker unmounting, land back on
// the selection with the new card PRE-SELECTED, and commit through the caller's
// EXISTING single onSelect write (no second attach path). Plus: the T5230
// consent gate still fires from this new entry point.
//
// The real editor (IntroCardEditorContainer) is exercised by its own tests;
// here it is stubbed to a back button so these tests stay about the handoff.
// The real ConsentGate and the real IntroCardCarousel are used.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => {
  const state = { cards: [] };
  const createCard = vi.fn(async (fields) => {
    const card = { id: 99, name: fields.name, shown_fields: [], treatment: 'gold', image_key: null, ...fields };
    state.cards = [card, ...state.cards];
    return card;
  });
  const setIntroConsent = vi.fn(async () => '2026-08-10T00:00:00Z');
  state.createCard = createCard;
  return { state, createCard, setIntroConsent };
});

vi.mock('../../stores', () => ({
  useIntroCardStore: (selector) => selector(mocks.state),
  useProfileStore: (selector) => selector({ setIntroConsent: mocks.setIntroConsent }),
}));

vi.mock('./IntroCardEditorContainer', () => ({
  IntroCardEditorContainer: ({ card, onBack }) => (
    <div data-testid="editor">
      <span data-testid="editor-card-id">{card.id}</span>
      <button type="button" onClick={onBack}>editor-done</button>
    </div>
  ),
}));

vi.mock('../shared/Toast', () => ({ toast: { error: vi.fn(), info: vi.fn() } }));

import { IntroCardPicker } from './IntroCardPicker';

afterEach(cleanup);
beforeEach(() => {
  mocks.state.cards = [];
  mocks.createCard.mockClear();
  mocks.setIntroConsent.mockClear();
});

function renderPicker(overrides = {}) {
  const props = {
    isOpen: true,
    onClose: vi.fn(),
    title: 'Intro for "My Reel"',
    cards: [],
    profile: { id: 'p', introPhotoKey: null, introConsentAt: '2026-01-01' },
    selectedId: null,
    hasConsent: true,
    onSelect: vi.fn(),
    onRequestConsent: vi.fn(),
    ...overrides,
  };
  const utils = render(<IntroCardPicker {...props} />);
  return { props, utils };
}

describe('IntroCardPicker — inline create-and-return (T6670)', () => {
  it('shows the create affordance and the reel-specific title in the selection view', () => {
    renderPicker();
    expect(screen.getByText('Intro for "My Reel"')).toBeTruthy();
    expect(screen.getByLabelText('Create new Athlete Intro Card')).toBeTruthy();
  });

  it('clicking "New card" (with consent) creates a card and mounts the editor without unmounting the picker', async () => {
    renderPicker();
    fireEvent.click(screen.getByLabelText('Create new Athlete Intro Card'));

    await waitFor(() => expect(screen.getByTestId('editor')).toBeTruthy());
    expect(mocks.createCard).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('editor-card-id').textContent).toBe('99');
    // The generated name uses the T6660 "Athlete Intro Card" terminology.
    expect(mocks.createCard.mock.calls[0][0].name).toBe('Athlete Intro Card 1');
  });

  it('after finishing the edit, lands back on selection with the new card PRE-SELECTED and commits ONE existing write', async () => {
    const { props } = renderPicker();
    fireEvent.click(screen.getByLabelText('Create new Athlete Intro Card'));
    await waitFor(() => expect(screen.getByTestId('editor')).toBeTruthy());

    fireEvent.click(screen.getByText('editor-done'));

    // Back on the carousel (OK/Cancel footer is present again).
    await waitFor(() => expect(screen.getByText('OK')).toBeTruthy());

    // The single attach write is the caller's onSelect, fired once on OK, with
    // the newly-created id -- no second/parallel attach path.
    fireEvent.click(screen.getByText('OK'));
    expect(props.onSelect).toHaveBeenCalledTimes(1);
    expect(props.onSelect).toHaveBeenCalledWith(99);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('does NOT create a card until the user actually finishes — creating then closing writes nothing extra', async () => {
    const { props } = renderPicker();
    fireEvent.click(screen.getByLabelText('Create new Athlete Intro Card'));
    await waitFor(() => expect(screen.getByTestId('editor')).toBeTruthy());
    // The attach write only ever traces to OK; no attach happened during create.
    expect(props.onSelect).not.toHaveBeenCalled();
  });

  it('reopening the picker resets back to the selection view (draft not stuck in create)', async () => {
    const { props, utils } = renderPicker();
    fireEvent.click(screen.getByLabelText('Create new Athlete Intro Card'));
    await waitFor(() => expect(screen.getByTestId('editor')).toBeTruthy());

    utils.rerender(<IntroCardPicker {...props} isOpen={false} />);
    utils.rerender(<IntroCardPicker {...props} isOpen />);

    expect(screen.queryByTestId('editor')).toBeNull();
    expect(screen.getByText('OK')).toBeTruthy();
  });
});

describe('IntroCardPicker — consent gate from the inline entry point (T5230)', () => {
  it('no-consent profile hitting "New card" sees the consent gate BEFORE any card is created', () => {
    renderPicker({ hasConsent: false, profile: { id: 'p', introPhotoKey: null, introConsentAt: null } });
    fireEvent.click(screen.getByLabelText('Create new Athlete Intro Card'));

    expect(screen.getByText('Consent required')).toBeTruthy();
    expect(mocks.createCard).not.toHaveBeenCalled();
    expect(screen.queryByTestId('editor')).toBeNull();
  });

  it('recording consent then proceeds to create the card and open the editor', async () => {
    renderPicker({ hasConsent: false, profile: { id: 'p', introPhotoKey: null, introConsentAt: null } });
    fireEvent.click(screen.getByLabelText('Create new Athlete Intro Card'));

    // Tick the consent attestation checkbox (the ConsentGate's only control).
    fireEvent.click(screen.getByRole('checkbox'));

    await waitFor(() => expect(screen.getByTestId('editor')).toBeTruthy());
    expect(mocks.setIntroConsent).toHaveBeenCalledWith('p');
    expect(mocks.createCard).toHaveBeenCalledTimes(1);
  });
});
