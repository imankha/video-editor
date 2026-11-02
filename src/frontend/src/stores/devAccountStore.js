import { create } from 'zustand';

/**
 * T11500: DEV-only account picker state. Memory only; nothing here persists.
 * `presets` is null unless the dev-accounts probe returned 200.
 */
export const useDevAccountStore = create((set) => ({
  presets: null,
  stackId: null,
  error: null,
  pendingPreset: null,
  useRealSignIn: false,

  setFromProbe: (probe) => set({ presets: probe?.presets ?? null, stackId: probe?.stackId ?? null }),
  setError: (error) => set({ error }),

  // The gesture: a card click.
  pick: async (preset) => {
    set({ pendingPreset: preset, error: null });
    try {
      const { loginAsDevPreset } = await import('../utils/devAccounts');
      await loginAsDevPreset(preset);
    } catch (err) {
      set({ pendingPreset: null, error: err.message });
    }
  },

  showRealSignIn: () => set({ useRealSignIn: true }),
}));
