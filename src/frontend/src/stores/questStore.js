import { create } from 'zustand';
import { API_BASE } from '../config';
import { QUESTS, TOTAL_STEPS } from '../config/questDefinitions';
import { useCreditStore } from './creditStore';
import { useGalleryStore } from './galleryStore';

/**
 * Quest Store — manages quest progress, panel state, and reward claiming (T540).
 *
 * Backend is authoritative for progress derivation. This store caches the
 * latest progress response and provides UI state for the quest panel.
 */
export const useQuestStore = create((set, get) => ({
  // Panel state
  isOpen: false,

  // Quest progress from backend
  quests: [],          // [{id, steps: {step_id: bool}, completed: bool, reward_claimed: bool}]
  loaded: false,

  // Derived totals (computed on fetch)
  totalCompleted: 0,
  totalSteps: TOTAL_STEPS,

  // Panel actions — mutual exclusion with Gallery
  open: () => {
    useGalleryStore.getState().close();
    set({ isOpen: true });
  },
  close: () => set({ isOpen: false }),
  toggle: () => {
    const { isOpen } = get();
    if (!isOpen) {
      useGalleryStore.getState().close();
    }
    set({ isOpen: !isOpen });
  },

  fetchProgress: async () => {
    try {
      const res = await fetch(`${API_BASE}/api/quests/progress`, { credentials: 'include' });
      if (!res.ok) return;
      const data = await res.json();

      // Compute totals from backend response
      let totalCompleted = 0;
      for (const quest of data.quests) {
        totalCompleted += Object.values(quest.steps).filter(Boolean).length;
      }

      set({
        quests: data.quests,
        loaded: true,
        totalCompleted,
      });
    } catch {
      // Best-effort — quest progress is not blocking
    }
  },

  claimReward: async (questId) => {
    try {
      const res = await fetch(`${API_BASE}/api/quests/${questId}/claim-reward`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Failed to claim reward');
      }
      const data = await res.json();

      // Update credit store with new balance
      useCreditStore.getState().setBalance(data.new_balance);

      // Refresh quest progress
      await get().fetchProgress();

      return data;
    } catch (err) {
      throw err;
    }
  },

  recordAchievement: async (key) => {
    // Fire-and-forget POST, then refresh progress
    try {
      await fetch(`${API_BASE}/api/quests/achievements/${key}`, {
        method: 'POST',
        credentials: 'include',
      });
    } catch {
      // Best-effort
    }
    // Refresh quest progress regardless
    get().fetchProgress();
  },

  reset: () => set({ isOpen: false, quests: [], loaded: false, totalCompleted: 0 }),
}));

// Selector hooks
export const useQuestIsOpen = () => useQuestStore((s) => s.isOpen);
export const useQuestProgress = () => useQuestStore((s) => ({
  quests: s.quests,
  loaded: s.loaded,
  totalCompleted: s.totalCompleted,
  totalSteps: s.totalSteps,
}));
