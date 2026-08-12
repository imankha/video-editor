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
// Bumped by reset() (profile switch). A fetch started before the bump must not
// write its result into the store: card ids are per-profile AUTOINCREMENT, so a
// stale library silently attaches the WRONG card in the new profile (T6930).
let _generation = 0;

export const useIntroCardStore = create((set) => ({
  // Raw card rows from the API, verbatim (no transformation before storing).
  cards: [],
  isLoading: false,
  isInitialized: false,
  error: null,
  // T6950: bumped on every successful deleteCard. The delete gesture lives in
  // the library modal, but DELETE /api/intro-cards/{id} also nulls
  // final_videos.intro_card_id server-side for every reel that referenced the
  // card — surfaces holding reel-list copies (DownloadsPanel's flat list,
  // member caches, badges) watch this to mirror that cascade locally.
  //
  // Deliberate deviation from the T6950 task file (reviewer-accepted): the
  // consumers RECONCILE locally (null any cached intro_card_id not in the
  // surviving library) instead of refetching the lists. This is not a
  // client-side "prediction": card ids are AUTOINCREMENT and never reused, so
  // set-difference against the live library is exact — while a refetch would
  // be N requests (one per cached member group) for a rare gesture.
  deleteRevision: 0,

  /**
   * Load the profile's cards. Deduped: concurrent callers share one request.
   */
  fetchCards: async ({ force = false } = {}) => {
    if (_fetchPromise && !force) return _fetchPromise;

    const gen = _generation;
    set({ isLoading: true, error: null });
    let promise;
    promise = (async () => {
      try {
        const response = await apiFetch(`${API_BASE}/api/intro-cards`);
        if (!response.ok) {
          throw new Error(`Failed to fetch intro cards: ${response.status}`);
        }
        const data = await response.json();
        if (gen !== _generation) return; // profile switched mid-flight — discard
        set({ cards: data.cards || [], isLoading: false, isInitialized: true });
      } catch (error) {
        console.error('[IntroCardStore] Failed to fetch cards:', error);
        if (gen !== _generation) return;
        set({ isLoading: false, isInitialized: true, error: error.message });
      } finally {
        if (_fetchPromise === promise) _fetchPromise = null;
      }
    })();
    _fetchPromise = promise;
    return promise;
  },

  /**
   * Create a card (gesture: "Add card"). Returns the created row. Throws on
   * failure (e.g. the T5230 consent-gate 403) WITH the backend's actual
   * `detail` message -- a prior version swallowed the response and returned
   * null, so a blocked create was a silent no-op with no error shown
   * anywhere (found live, T5230 QA: the consent gate itself worked, nothing
   * told the user why nothing happened). Callers must catch and surface it.
   */
  createCard: async (fields) => {
    const response = await apiFetch(`${API_BASE}/api/intro-cards`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(body?.detail || `Failed to create card (${response.status})`);
    }
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
   * Delete a card (gesture: "Delete card"). The backend also nulls referencing
   * reels and removes the R2 image. T6680: the default/inherit concept is
   * retired end-to-end, so the backend no longer promotes a surviving row to
   * default and no longer reports `promoted_default_id` — this is a plain
   * removal from the list, nothing else to apply.
   */
  deleteCard: async (cardId) => {
    const response = await apiFetch(`${API_BASE}/api/intro-cards/${cardId}`, {
      method: 'DELETE',
    });
    if (!response.ok) return false;
    set((state) => ({
      cards: state.cards.filter((c) => c.id !== cardId),
      deleteRevision: state.deleteRevision + 1,
    }));
    return true;
  },

  // Profile-scope teardown (called from profileStore._resetDataStores). Also
  // invalidates any in-flight fetch so the old profile's rows can't land after
  // the clear, and drops the dedup handle so the next fetchCards() hits the
  // new profile's API instead of returning the stale promise.
  //
  // deleteRevision deliberately SURVIVES reset: it is a monotonic change
  // signal, and consumers ref-compare it — rewinding it to 0 here would make
  // every mounted consumer see a "change" on the next delete-after-switch (or
  // fire a spurious prune on switch). Do not "fix" this to reset it.
  reset: () => {
    _generation += 1;
    _fetchPromise = null;
    set({ cards: [], isLoading: false, isInitialized: false, error: null });
  },
}));
