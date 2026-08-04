import { create } from 'zustand';
import { API_BASE } from '../config';
import apiFetch from '../utils/apiFetch';

/**
 * Intro Card Store (T5195)
 *
 * Holds the current profile's intro card library as RAW rows exactly as the API
 * returns them — no derived state. There is no `hasDefault` boolean and no
 * cached composition here: composition is computed on read via the shared
 * `selectCardComposition` selector (utils/introCardComposition.js), and "the
 * default card" is found by filtering the rows. Every write is a named editor
 * gesture; the backend owns single-default enforcement and reel detachment.
 *
 * The editor UI (T5205) is a separate task — this store is the data layer it
 * will bind to.
 */

let _fetchPromise = null;

export const useIntroCardStore = create((set, get) => ({
  // Raw card rows from the API, verbatim (no transformation before storing).
  cards: [],
  isLoading: false,
  isInitialized: false,
  error: null,

  /**
   * Load the profile's cards. Deduped: concurrent callers share one request.
   */
  fetchCards: async ({ force = false } = {}) => {
    if (_fetchPromise && !force) return _fetchPromise;

    set({ isLoading: true, error: null });
    _fetchPromise = (async () => {
      try {
        const response = await apiFetch(`${API_BASE}/api/intro-cards`);
        if (!response.ok) {
          throw new Error(`Failed to fetch intro cards: ${response.status}`);
        }
        const data = await response.json();
        set({ cards: data.cards || [], isLoading: false, isInitialized: true });
      } catch (error) {
        console.error('[IntroCardStore] Failed to fetch cards:', error);
        set({ isLoading: false, isInitialized: true, error: error.message });
      } finally {
        _fetchPromise = null;
      }
    })();
    return _fetchPromise;
  },

  /**
   * Create a card (gesture: "Add card"). Returns the created row or null.
   */
  createCard: async (fields) => {
    const response = await apiFetch(`${API_BASE}/api/intro-cards`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields),
    });
    if (!response.ok) return null;
    const card = await response.json();
    set((state) => ({ cards: [card, ...state.cards] }));
    return card;
  },

  /**
   * Surgical update (gesture: one edited field). Sends ONLY the changed field(s)
   * — never the whole card — matching the backend persistence rule.
   */
  updateCard: async (cardId, changedFields) => {
    const response = await apiFetch(`${API_BASE}/api/intro-cards/${cardId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(changedFields),
    });
    if (!response.ok) return null;
    const updated = await response.json();
    set((state) => ({
      cards: state.cards.map((c) => (c.id === cardId ? updated : c)),
    }));
    return updated;
  },

  /**
   * Set a card as the profile default (gesture: "Make default"). The backend
   * clears the previous default atomically; refetch to reflect both rows.
   */
  setDefault: async (cardId) => {
    const response = await apiFetch(`${API_BASE}/api/intro-cards/${cardId}/default`, {
      method: 'POST',
    });
    if (!response.ok) return false;
    // The server flips is_default on two rows in one transaction; re-pull the
    // authoritative list rather than guessing the previous default locally.
    await get().fetchCards({ force: true });
    return true;
  },

  /**
   * Delete a card (gesture: "Delete card"). The backend also nulls referencing
   * reels and removes the R2 image.
   */
  deleteCard: async (cardId) => {
    const response = await apiFetch(`${API_BASE}/api/intro-cards/${cardId}`, {
      method: 'DELETE',
    });
    if (!response.ok) return false;
    set((state) => ({ cards: state.cards.filter((c) => c.id !== cardId) }));
    return true;
  },

  reset: () => set({ cards: [], isLoading: false, isInitialized: false, error: null }),
}));

/**
 * The default card, or null. Derived on read (no stored `hasDefault` flag).
 * @param {object} state
 */
export const selectDefaultCard = (state) =>
  state.cards.find((c) => c.is_default) || null;
