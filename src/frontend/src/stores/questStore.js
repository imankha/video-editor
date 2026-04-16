import { create } from 'zustand';
import { API_BASE } from '../config';
import { useCreditStore } from './creditStore';
import { track } from '../utils/analytics';

// Module-level ref for fetch dedup
let _fetchProgressPromise = null;
let _fetchProgressGeneration = 0;
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

    // Generation counter prevents stale responses from overwriting newer data.
    // Scenario: non-force fetch starts (gen 1), then force fetch starts (gen 2).
    // If gen 1 resolves after gen 2, its result is discarded.
    const generation = ++_fetchProgressGeneration;

    _fetchProgressPromise = (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/quests/progress`, { credentials: 'include' });
        if (!res.ok) {
          // T1330: unauthenticated — render the quest panel with zero progress
          // so new visitors see the onboarding checklist pre-login.
          if (res.status === 401 && generation === _fetchProgressGeneration) {
            set({ quests: [], loaded: true, totalCompleted: 0, activeQuestId: 'quest_1' });
            return;
          }
          console.warn(`[Quests] fetchProgress failed: ${res.status}`);
          return;
        }
        const data = await res.json();

        // Stale response guard: a newer fetch was started while we were in flight
        if (generation !== _fetchProgressGeneration) return;

        let totalCompleted = 0;
        for (const quest of data.quests) {
          totalCompleted += Object.values(quest.steps).filter(Boolean).length;
        }

        // Progressive disclosure: show first unclaimed quest
        const q1 = data.quests.find(q => q.id === 'quest_1');
        const q2 = data.quests.find(q => q.id === 'quest_2');
        const q3 = data.quests.find(q => q.id === 'quest_3');
        let activeQuestId = 'quest_1';
        if (q1?.reward_claimed) activeQuestId = 'quest_2';
        if (q1?.reward_claimed && q2?.reward_claimed) activeQuestId = 'quest_3';
        if (q1?.reward_claimed && q2?.reward_claimed && q3?.reward_claimed) activeQuestId = 'quest_4';

        set({
          quests: data.quests,
          loaded: true,
          totalCompleted,
          activeQuestId,
        });
      } catch {
        // Best-effort
      } finally {
        if (generation === _fetchProgressGeneration) {
          _fetchProgressPromise = null;
        }
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

  recordAchievement: (key) => {
    // Dedup: skip if already recorded this session
    if (_recordedAchievements.has(key)) return;
    _recordedAchievements.add(key);

    // T1531: fire-and-forget. The achievement write is gesture-driven but its
    // result does not gate the UI — never block the caller (e.g. opening the
    // framing editor) on this POST. `keepalive: true` lets the request survive
    // a navigation/unload, so dedup is safe even if the user routes away.
    fetch(`${API_BASE}/api/quests/achievements/${key}`, {
      method: 'POST',
      credentials: 'include',
      keepalive: true,
    })
      .then((res) => {
        if (!res.ok) {
          console.error(`[Quests] Achievement POST failed for '${key}': ${res.status}`);
          _recordedAchievements.delete(key);
          return;
        }
        get().fetchProgress({ force: true });
      })
      .catch(() => {
        _recordedAchievements.delete(key);
      });
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
