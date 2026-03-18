import { create } from 'zustand';
import { API_BASE } from '../config';

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

  fetchCredits: async () => {
    try {
      const res = await fetch(`${API_BASE}/api/credits`, { credentials: 'include' });
      if (!res.ok) return;
      const data = await res.json();
      set({
        balance: data.balance,
        loaded: true,
      });
    } catch {
      // Best-effort — credits are not blocking on fetch failure
    }
  },

  setBalance: (balance) => set({ balance }),

  reset: () => set({ balance: 0, loaded: false }),

  // Optimistic check — backend is authoritative
  canAffordExport: (videoSeconds) => {
    const { balance } = get();
    return balance >= Math.ceil(videoSeconds);
  },

  getRequiredCredits: (videoSeconds) => Math.ceil(videoSeconds),
}));
