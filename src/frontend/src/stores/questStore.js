import { create } from 'zustand';
import { API_BASE } from '../config';
import { useCreditStore } from './creditStore';
import { track } from '../utils/analytics';

// Module-level ref for fetch dedup
let _fetchProgressPromise = null;
let _fetchDefinitionsPromise = null;
// Track achievements already recorded this session to prevent duplicate POSTs
const _recordedAchievements = new Set();

/**
 * Quest Store — manages quest progress and reward claiming (T540, T1000).
 *
 * Quest definitions (structure, titles, rewards) are fetched from the backend
 * via GET /api/quests/definitions — single source of truth (T1000).
 * Progress is fetched separately via GET /api/quests/progress.
 */
export const useQuestStore = create((set, get) => ({
  // Quest definitions from backend (T1000)
  definitions: null, // [{id, title, reward, step_ids}]

  // Quest progress from backend
  quests: [],
  loaded: false,

  // Derived totals (computed on fetch)
  totalCompleted: 0,
  totalSteps: 0,

  // Which quest is currently active (progressive disclosure)
  activeQuestId: null,

  fetchDefinitions: async () => {
    if (_fetchDefinitionsPromise) return _fetchDefinitionsPromise;
    _fetchDefinitionsPromise = (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/quests/definitions`);
        if (!res.ok) return;
        const data = await res.json();
        const totalSteps = data.reduce((sum, q) => sum + q.step_ids.length, 0);
        set({ definitions: data, totalSteps });
      } catch {
        // Best-effort
      } finally {
        _fetchDefinitionsPromise = null;
      }
    })();
    return _fetchDefinitionsPromise;
  },

  fetchProgress: async ({ force = false } = {}) => {
    // Dedup: if a fetch is already in flight, return the existing promise
    if (_fetchProgressPromise && !force) return _fetchProgressPromise;

    const _tFetch = performance.now();
    console.log(`[ExportTiming] fetchProgress START (force=${force})`);
    _fetchProgressPromise = (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/quests/progress`, { credentials: 'include' });
        console.log(`[ExportTiming] fetchProgress response in ${(performance.now()-_tFetch).toFixed(0)}ms (status=${res.status})`);
        if (!res.ok) {
          return;
        }
        const data = await res.json();

        const q2 = data.quests.find(q => q.id === 'quest_2');
        if (q2) {
          console.log(`[ExportTiming] fetchProgress: export_framing=${q2.steps.export_framing}`);
        }

        let totalCompleted = 0;
        for (const quest of data.quests) {
          totalCompleted += Object.values(quest.steps).filter(Boolean).length;
        }

        // Progressive disclosure: show first unclaimed quest
        const q1 = data.quests.find(q => q.id === 'quest_1');
        const q2b = data.quests.find(q => q.id === 'quest_2');
        const q3 = data.quests.find(q => q.id === 'quest_3');
        let activeQuestId = 'quest_1';
        if (q1?.reward_claimed) activeQuestId = 'quest_2';
        if (q1?.reward_claimed && q2b?.reward_claimed) activeQuestId = 'quest_3';
        if (q1?.reward_claimed && q2b?.reward_claimed && q3?.reward_claimed) activeQuestId = 'quest_4';

        console.log(`[ExportTiming] fetchProgress DONE in ${(performance.now()-_tFetch).toFixed(0)}ms — completed=${totalCompleted}, activeQuest=${activeQuestId}`);
        set({
          quests: data.quests,
          loaded: true,
          totalCompleted,
          activeQuestId,
        });
      } catch (err) {
        console.error(`[ExportTiming] fetchProgress EXCEPTION after ${(performance.now()-_tFetch).toFixed(0)}ms:`, err);
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
    _fetchDefinitionsPromise = null;
    _recordedAchievements.clear();
    set({
      definitions: null,
      quests: [],
      loaded: false,
      totalCompleted: 0,
      totalSteps: 0,
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
