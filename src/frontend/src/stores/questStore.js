import { create } from 'zustand';
import { API_BASE } from '../config';
import { QUESTS, TOTAL_STEPS } from '../config/questDefinitions';
import { useCreditStore } from './creditStore';

/**
 * Quest Store — manages quest progress and reward claiming (T540).
 *
 * Backend is authoritative for progress derivation. This store caches the
 * latest progress response. The QuestPanel component manages its own
 * collapsed/expanded/hidden UI state independently.
 */
export const useQuestStore = create((set, get) => ({
  // Quest progress from backend
  quests: [],
  loaded: false,

  // Derived totals (computed on fetch)
  totalCompleted: 0,
  totalSteps: TOTAL_STEPS,

  // Which quest is currently active (progressive disclosure)
  activeQuestId: null,

  fetchProgress: async () => {
    try {
      const res = await fetch(`${API_BASE}/api/quests/progress`, { credentials: 'include' });
      if (!res.ok) return;
      const data = await res.json();

      let totalCompleted = 0;
      for (const quest of data.quests) {
        totalCompleted += Object.values(quest.steps).filter(Boolean).length;
      }

      const q1 = data.quests.find(q => q.id === 'quest_1');
      let activeQuestId = 'quest_1';
      if (q1?.reward_claimed) {
        activeQuestId = 'quest_2';
      }

      set({
        quests: data.quests,
        loaded: true,
        totalCompleted,
        activeQuestId,
      });
    } catch {
      // Best-effort
    }
  },

  claimReward: async (questId) => {
    const res = await fetch(`${API_BASE}/api/quests/${questId}/claim-reward`, {
      method: 'POST',
      credentials: 'include',
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Failed to claim reward');
    }
    const data = await res.json();
    useCreditStore.getState().setBalance(data.new_balance);
    await get().fetchProgress();
    return data;
  },

  recordAchievement: async (key) => {
    try {
      await fetch(`${API_BASE}/api/quests/achievements/${key}`, {
        method: 'POST',
        credentials: 'include',
      });
    } catch {
      // Best-effort
    }
    get().fetchProgress();
  },

  reset: () => set({
    quests: [],
    loaded: false,
    totalCompleted: 0,
    activeQuestId: null,
  }),
}));

// Selector hooks
export const useQuestProgress = () => useQuestStore((s) => ({
  quests: s.quests,
  loaded: s.loaded,
  totalCompleted: s.totalCompleted,
  totalSteps: s.totalSteps,
}));
