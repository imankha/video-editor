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
   * Optimistic, LOCAL-ONLY merge into a card row — no network call. The editor
   * (T5205) applies each gesture locally first so the live preview updates
   * instantly, then persists via `updateCard` (debounced for text styling). The
   * store stays the single source of truth: this is an optimistic write TO the
   * store, not a duplicate copy held in a component's useState. On a failed
   * persist the caller reconciles with `fetchCards({ force: true })`.
   */
  patchCardLocal: (cardId, fields) =>
    set((state) => ({
      cards: state.cards.map((c) => (c.id === cardId ? { ...c, ...fields } : c)),
    })),

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
      cards: state.cards.map((c) => {
        if (c.id !== cardId) return c;
        // Merge ONLY the fields this call changed (plus the server-derived
        // refreshes) onto the CURRENT row — never the full server snapshot.
        // The editor fires surgical single-field PATCHes and a debounced
        // text_elements write can resolve AFTER a later gesture changed a
        // different field; replacing the whole row with this response's stale
        // snapshot of that other field would silently revert the newer edit
        // (lost update on read). Per field the server is authoritative and the
        // DB serialises the writes, so applying just the changed keys keeps the
        // store the single source of truth without clobbering concurrent edits.
        const merged = { ...c };
        for (const key of Object.keys(changedFields)) merged[key] = updated[key];
        if ('updated_at' in updated) merged.updated_at = updated.updated_at;
        // image_key change also brings a freshly presigned preview URL.
        if ('image_key' in changedFields && 'previewUrl' in updated) {
          merged.previewUrl = updated.previewUrl;
        }
        return merged;
      }),
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
   * reels and removes the R2 image. T6640 round 2 invariant: if the deleted
   * card WAS the default and others remain, the backend auto-promotes the
   * newest remaining one IN THE SAME TRANSACTION and reports it as
   * `promoted_default_id` — apply that surgically here (the only OTHER row
   * that could have been the default is the one just deleted, so no other row
   * needs touching) so the library shows the new Default badge without a
   * reload, per the same "no window with the wrong default" guarantee the
   * server enforces.
   */
  deleteCard: async (cardId) => {
    const response = await apiFetch(`${API_BASE}/api/intro-cards/${cardId}`, {
      method: 'DELETE',
    });
    if (!response.ok) return false;
    const result = await response.json().catch(() => ({}));
    const promotedId = result.promoted_default_id;
    set((state) => ({
      cards: state.cards
        .filter((c) => c.id !== cardId)
        .map((c) => (promotedId && c.id === promotedId ? { ...c, is_default: true } : c)),
    }));
    return true;
  },

  // T5215: the CURRENT profile's reel-length floor for the inherit-the-default
  // intro resolution path. Lives on profile.sqlite (per-profile, like the
  // default card itself), so — unlike the rest of this store — it is scoped
  // to whichever profile is ACTIVE, not addressable by an arbitrary profile
  // id (GET/PATCH /api/profiles/current/intro-min-duration).
  minDuration: null, // null = not yet loaded; the endpoint's own default is 20.0
  isMinDurationLoading: false,

  fetchMinDuration: async () => {
    set({ isMinDurationLoading: true });
    try {
      const response = await apiFetch(`${API_BASE}/api/profiles/current/intro-min-duration`);
      if (!response.ok) throw new Error(`Failed to fetch intro duration threshold: ${response.status}`);
      const data = await response.json();
      set({ minDuration: data.intro_min_duration_seconds, isMinDurationLoading: false });
    } catch (error) {
      console.error('[IntroCardStore] Failed to fetch intro_min_duration_seconds:', error);
      set({ isMinDurationLoading: false });
    }
  },

  /**
   * Surgical write (gesture: blur/Enter on the threshold input). Throws on a
   * rejected (out-of-range) value so the caller's input can show the error —
   * the store does NOT optimistically update on a value the server may 400.
   */
  updateMinDuration: async (seconds) => {
    const response = await apiFetch(`${API_BASE}/api/profiles/current/intro-min-duration`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ intro_min_duration_seconds: seconds }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw new Error(data?.detail || `Failed to update intro duration threshold: ${response.status}`);
    }
    const data = await response.json();
    set({ minDuration: data.intro_min_duration_seconds });
    return data.intro_min_duration_seconds;
  },

  reset: () => set({ cards: [], isLoading: false, isInitialized: false, error: null, minDuration: null }),
}));

/**
 * The default card, or null. Derived on read (no stored `hasDefault` flag).
 * @param {object} state
 */
export const selectDefaultCard = (state) =>
  state.cards.find((c) => c.is_default) || null;
