import { create } from 'zustand';
import { API_BASE } from '../config';
import apiFetch from '../utils/apiFetch';

let _fetchPromise = null;

/**
 * Credit cost for a video duration: round-half-up with a 1-credit floor for any
 * positive duration (T9750). MIRRORS the backend `round_credits_half_up` in
 * highlight_transform.py and MUST stay in sync with it -- this is the optimistic
 * client-side estimate feeding the pre-flight affordability check and the
 * insufficient-credits modal number; the backend remains authoritative.
 *
 * Uses `Math.floor(x + 0.5)` (not `Math.round`) to match the backend idiom
 * exactly and keep the billing rule unambiguous: an exact `.5` always rounds UP.
 */
export function roundCreditsHalfUp(videoSeconds) {
  if (!(videoSeconds > 0)) return 0;
  return Math.max(1, Math.floor(videoSeconds + 0.5));
}

/**
 * Credit Store - Manages credit balance (T530)
 *
 * Backend is authoritative — this store provides optimistic checks
 * to prevent unnecessary API calls and give instant UI feedback.
 *
 * Data flow:
 * 1. On auth success → fetchCredits() populates store
 * 2. Export button checks canAffordExport() (optimistic)
 * 3. Backend does authoritative check + deduction
 * 4. On success → setBalance() updates local state
 * 5. On 402 → InsufficientCreditsModal shown with backend values
 */
export const useCreditStore = create((set, get) => ({
  balance: 0,
  loaded: false,

  setFromBootstrap: (credits) => {
    set({ balance: credits.balance, loaded: true });
  },

  fetchCredits: async () => {
    if (_fetchPromise) return _fetchPromise;
    _fetchPromise = (async () => {
      try {
        const res = await apiFetch(`${API_BASE}/api/credits`);
        if (!res.ok) return;
        const data = await res.json();
        set({
          balance: data.balance,
          loaded: true,
        });
      } catch {
        // Best-effort — credits are not blocking on fetch failure
      } finally {
        _fetchPromise = null;
      }
    })();
    return _fetchPromise;
  },

  setBalance: (balance) => set({ balance }),

  reset: () => set({ balance: 0, loaded: false }),

  // Optimistic check — backend is authoritative
  canAffordExport: (videoSeconds) => {
    const { balance } = get();
    return balance >= roundCreditsHalfUp(videoSeconds);
  },

  getRequiredCredits: (videoSeconds) => roundCreditsHalfUp(videoSeconds),
}));
