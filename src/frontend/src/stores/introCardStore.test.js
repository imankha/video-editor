import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockFetch = vi.fn();
global.fetch = mockFetch;

vi.mock('../config', () => ({ API_BASE: '' }));

import { useIntroCardStore, selectDefaultCard } from './introCardStore';

function jsonResponse(body, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

describe('introCardStore', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    useIntroCardStore.getState().reset();
  });

  it('stores API rows verbatim (no transformation)', async () => {
    const rows = [
      { id: 1, name: 'A', shown_fields: ['position'], image_key: 'k', is_default: false, composition: 'hero' },
    ];
    mockFetch.mockResolvedValueOnce(jsonResponse({ cards: rows }));

    await useIntroCardStore.getState().fetchCards();

    // Exact same objects, untouched.
    expect(useIntroCardStore.getState().cards).toEqual(rows);
    expect(useIntroCardStore.getState().isInitialized).toBe(true);
  });

  it('createCard prepends the returned row', async () => {
    const created = { id: 5, name: 'New', shown_fields: [], is_default: false };
    mockFetch.mockResolvedValueOnce(jsonResponse(created));

    const result = await useIntroCardStore.getState().createCard({ name: 'New', treatment: 'gold' });

    expect(result).toEqual(created);
    expect(useIntroCardStore.getState().cards[0]).toEqual(created);
    // Body carried the fields as-is.
    const [, opts] = mockFetch.mock.calls[0];
    expect(JSON.parse(opts.body)).toEqual({ name: 'New', treatment: 'gold' });
  });

  it('createCard throws the backend detail message on failure (T5230 consent-gate 403)', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ detail: 'Parental consent is required before creating an intro card.' }, false, 403),
    );

    await expect(
      useIntroCardStore.getState().createCard({ name: 'New', treatment: 'gold' }),
    ).rejects.toThrow('Parental consent is required before creating an intro card.');

    // A blocked create must not silently add a phantom row.
    expect(useIntroCardStore.getState().cards).toEqual([]);
  });

  it('updateCard sends ONLY the changed field (surgical) and replaces the row', async () => {
    useIntroCardStore.setState({ cards: [{ id: 3, name: 'Old', title_text: 'keep' }] });
    const updated = { id: 3, name: 'New', title_text: 'keep' };
    mockFetch.mockResolvedValueOnce(jsonResponse(updated));

    await useIntroCardStore.getState().updateCard(3, { name: 'New' });

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain('/api/intro-cards/3');
    expect(opts.method).toBe('PATCH');
    expect(JSON.parse(opts.body)).toEqual({ name: 'New' }); // one field only
    expect(useIntroCardStore.getState().cards[0]).toEqual(updated);
  });

  it('updateCard merges only the changed field, preserving a concurrent optimistic edit (T5205)', async () => {
    // Local row already carries an optimistic shown_fields edit from a later
    // gesture; an in-flight debounced text_elements PATCH now resolves with a
    // server snapshot that predates that edit. The merge must NOT revert it.
    useIntroCardStore.setState({ cards: [{ id: 7, shown_fields: ['position'], text_elements: { title: { size: 1 } }, treatment: 'gold' }] });
    const staleServerRow = { id: 7, shown_fields: [], text_elements: { title: { size: 2 } }, treatment: 'gold', updated_at: 't1' };
    mockFetch.mockResolvedValueOnce(jsonResponse(staleServerRow));

    await useIntroCardStore.getState().updateCard(7, { text_elements: { title: { size: 2 } } });

    const row = useIntroCardStore.getState().cards[0];
    expect(row.text_elements).toEqual({ title: { size: 2 } }); // the changed field: server value
    expect(row.shown_fields).toEqual(['position']); // concurrent edit preserved, not reverted to []
    expect(row.updated_at).toBe('t1');
  });

  it('deleteCard removes the row from the list without any default promotion (T6680)', async () => {
    // T6680: is_default is retired end-to-end. Deleting a card must not
    // promote any surviving row -- the backend no longer returns
    // `promoted_default_id`, and even if a stale server response includes
    // one, the store must not act on it. RED against current behavior,
    // which flips is_default on the promoted row.
    useIntroCardStore.setState({ cards: [{ id: 1, is_default: true }, { id: 2, is_default: false }] });
    mockFetch.mockResolvedValueOnce(jsonResponse({ success: true, promoted_default_id: 2 }));

    await useIntroCardStore.getState().deleteCard(1);

    const cards = useIntroCardStore.getState().cards;
    expect(cards.map((c) => c.id)).toEqual([2]);
    expect(cards.find((c) => c.id === 2).is_default).toBe(false);
  });

  it('T6680: setDefault action is retired (no set-default gesture remains)', () => {
    // The manual "make default" gesture is removed end-to-end (Decision 4) --
    // there is no default to set. RED against current behavior, where
    // setDefault exists and calls POST /api/intro-cards/:id/default.
    expect(useIntroCardStore.getState().setDefault).toBeUndefined();
  });

  it('T6680: selectDefaultCard selector is retired (no default concept remains)', () => {
    // The picker/carousel no longer distinguishes a "default" card (OQ2/OQ5)
    // -- the selector itself should be gone, not just unused. RED against
    // current behavior, where selectDefaultCard is exported and functional.
    expect(selectDefaultCard).toBeUndefined();
  });

  it('T6930: reset() discards an in-flight fetch — the old profile\'s cards must not land after a profile switch', async () => {
    // Card ids are per-profile AUTOINCREMENT: a stale library silently
    // attaches the WRONG card in the new profile, so a fetch that started
    // before the switch must be dead on arrival.
    let resolveFetch;
    mockFetch.mockReturnValueOnce(new Promise((resolve) => { resolveFetch = resolve; }));
    const inFlight = useIntroCardStore.getState().fetchCards();

    useIntroCardStore.getState().reset(); // the profile switch

    resolveFetch(jsonResponse({ cards: [{ id: 2, name: 'Old profile card 2' }] }));
    await inFlight;

    expect(useIntroCardStore.getState().cards).toEqual([]);
    expect(useIntroCardStore.getState().isInitialized).toBe(false);
  });

  it('T6930: reset() drops the fetch dedup handle — the next fetch hits the network for the NEW profile', async () => {
    let resolveFetch;
    mockFetch.mockReturnValueOnce(new Promise((resolve) => { resolveFetch = resolve; }));
    const inFlight = useIntroCardStore.getState().fetchCards();

    useIntroCardStore.getState().reset();

    // Without the fix, this call would return the STALE in-flight promise and
    // never re-fetch. It must issue a second network request.
    const newRows = [{ id: 2, name: 'New profile card 2' }];
    mockFetch.mockResolvedValueOnce(jsonResponse({ cards: newRows }));
    await useIntroCardStore.getState().fetchCards();

    resolveFetch(jsonResponse({ cards: [{ id: 2, name: 'Old profile card 2' }] }));
    await inFlight;

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(useIntroCardStore.getState().cards).toEqual(newRows);
  });

  it('T6950: a successful deleteCard bumps deleteRevision (reel-list caches mirror the server cascade)', async () => {
    useIntroCardStore.setState({ cards: [{ id: 1 }] });
    const before = useIntroCardStore.getState().deleteRevision;
    mockFetch.mockResolvedValueOnce(jsonResponse({ success: true }));

    await useIntroCardStore.getState().deleteCard(1);

    expect(useIntroCardStore.getState().deleteRevision).toBe(before + 1);
  });

  it('T6950: a FAILED deleteCard does not bump deleteRevision', async () => {
    useIntroCardStore.setState({ cards: [{ id: 1 }] });
    const before = useIntroCardStore.getState().deleteRevision;
    mockFetch.mockResolvedValueOnce(jsonResponse({}, false, 500));

    await useIntroCardStore.getState().deleteCard(1);

    expect(useIntroCardStore.getState().deleteRevision).toBe(before);
    expect(useIntroCardStore.getState().cards).toEqual([{ id: 1 }]);
  });
});
