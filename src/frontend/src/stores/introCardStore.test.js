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

  it('setDefault refetches the authoritative list (does not guess locally)', async () => {
    useIntroCardStore.setState({
      cards: [{ id: 1, is_default: true }, { id: 2, is_default: false }],
    });
    mockFetch
      .mockResolvedValueOnce(jsonResponse({}, true)) // POST /default
      .mockResolvedValueOnce(
        jsonResponse({ cards: [{ id: 1, is_default: false }, { id: 2, is_default: true }] }),
      );

    await useIntroCardStore.getState().setDefault(2);

    // Exactly one default, sourced from the server refetch.
    const cards = useIntroCardStore.getState().cards;
    expect(cards.filter((c) => c.is_default)).toHaveLength(1);
    expect(selectDefaultCard(useIntroCardStore.getState()).id).toBe(2);
  });

  it('deleteCard removes the row from the list', async () => {
    useIntroCardStore.setState({ cards: [{ id: 1 }, { id: 2 }] });
    mockFetch.mockResolvedValueOnce(jsonResponse({ success: true }));

    await useIntroCardStore.getState().deleteCard(1);

    expect(useIntroCardStore.getState().cards.map((c) => c.id)).toEqual([2]);
  });

  it('selectDefaultCard returns null when no card is default', () => {
    useIntroCardStore.setState({ cards: [{ id: 1, is_default: false }] });
    expect(selectDefaultCard(useIntroCardStore.getState())).toBeNull();
  });
});
