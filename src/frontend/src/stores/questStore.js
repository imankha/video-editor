import { create } from 'zustand';
import { API_BASE } from '../config';
import { QUESTS, TOTAL_STEPS } from '../config/questDefinitions.jsx';
import { useCreditStore } from './creditStore';
import { track } from '../utils/analytics';

// Module-level ref for fetch dedup
let _fetchProgressPromise = null;
// Track achievements already recorded this session to prevent duplicate POSTs
const _recordedAchievements = new Set();

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

  fetchProgress: async ({ force = false } = {}) => {
    // Dedup: if a fetch is already in flight, return the existing promise
    if (_fetchProgressPromise && !force) return _fetchProgressPromise;

    _fetchProgressPromise = (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/quests/progress`, { credentials: 'include' });
        if (!res.ok) return;
        const data = await res.json();

        let totalCompleted = 0;
        for (const quest of data.quests) {
          totalCompleted += Object.values(quest.steps).filter(Boolean).length;
        }

        // Progressive disclosure: show first unclaimed quest
        const q1 = data.quests.find(q => q.id === 'quest_1');
        const q2 = data.quests.find(q => q.id === 'quest_2');
        let activeQuestId = 'quest_1';
        if (q1?.reward_claimed) activeQuestId = 'quest_2';
        if (q1?.reward_claimed && q2?.reward_claimed) activeQuestId = 'quest_3';

        set({
          quests: data.quests,
          loaded: true,
          totalCompleted,
          activeQuestId,
        });
      } catch {
        // Best-effort
      } finally {
        _fetchProgressPromise = null;
      }
    })();
    return _fetchProgressPromise;
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
    track('quest_reward_claimed', { questId });
    useCreditStore.getState().setBalance(data.new_balance);
    await get().fetchProgress({ force: true });
    return data;
  },

  recordAchievement: async (key) => {
    // Dedup: skip if already recorded this session
    if (_recordedAchievements.has(key)) return;
    _recordedAchievements.add(key);

    try {
      await fetch(`${API_BASE}/api/quests/achievements/${key}`, {
        method: 'POST',
        credentials: 'include',
      });
    } catch {
      // Best-effort
    }
    get().fetchProgress({ force: true });
  },

  reset: () => {
    _fetchProgressPromise = null;
    _recordedAchievements.clear();
    set({
      quests: [],
      loaded: false,
      totalCompleted: 0,
      activeQuestId: null,
    });
  },
}));

// Selector hooks
export const useQuestProgress = () => useQuestStore((s) => ({
  quests: s.quests,
  loaded: s.loaded,
  totalCompleted: s.totalCompleted,
  totalSteps: s.totalSteps,
}));
