import { create } from 'zustand';
import { API_BASE } from '../config';
import apiFetch from '../utils/apiFetch';
import { useCreditStore } from './creditStore';
import { track } from '../utils/analytics';
import { QUEST_DEFINITIONS } from '../data/questDefinitions';

// Module-level ref for fetch dedup
let _fetchProgressPromise = null;
let _fetchProgressGeneration = 0;
// Track achievements already recorded this session to prevent duplicate POSTs
const _recordedAchievements = new Set();

const _totalSteps = QUEST_DEFINITIONS.reduce((sum, q) => sum + q.step_ids.length, 0);

/**
 * Quest Store — manages quest progress and reward claiming (T540, T1000).
 *
 * Quest definitions (structure, titles, rewards) are fetched from the backend
 * via GET /api/quests/definitions — single source of truth (T1000).
 * Progress is fetched separately via GET /api/quests/progress.
 */
export const useQuestStore = create((set, get) => ({
  definitions: QUEST_DEFINITIONS,

  quests: [],
  loaded: false,

  totalCompleted: 0,
  totalSteps: _totalSteps,

  activeQuestId: null,

  // Ephemeral UI-only: per-detection assignment state for the select_players
  // step — a boolean[] in timeline order (or null). Pushed by OverlayContainer,
  // read by QuestPanel to render one checkbox per detection. Never persisted.
  detectionAssignProgress: null,
  setDetectionAssignProgress: (progress) => set({ detectionAssignProgress: progress }),

  // T7840: Ephemeral opener for the `upload_game` current step. ProjectManager
  // registers its auth-gated handleAddGameClick while mounted; QuestPanel reads
  // this to render that step as a real "Add Your First Game" button. Pure
  // component-lifetime wiring — never persisted, and deliberately NOT cleared in
  // reset() (it is owned by the mounting component's lifecycle, not user data).
  addGameOpener: null,
  setAddGameOpener: (opener) => set({ addGameOpener: opener }),

  fetchDefinitions: () => {},

  setFromBootstrap: (questsProgress) => {
    let totalCompleted = 0;
    for (const quest of questsProgress) {
      totalCompleted += Object.values(quest.steps).filter(Boolean).length;
    }
    const q1 = questsProgress.find(q => q.id === 'quest_1');
    const q2 = questsProgress.find(q => q.id === 'quest_2');
    const q3 = questsProgress.find(q => q.id === 'quest_3');
    let activeQuestId = 'quest_1';
    if (q1?.reward_claimed) activeQuestId = 'quest_2';
    if (q1?.reward_claimed && q2?.reward_claimed) activeQuestId = 'quest_3';
    if (q1?.reward_claimed && q2?.reward_claimed && q3?.reward_claimed) activeQuestId = 'quest_4';
    set({ quests: questsProgress, loaded: true, totalCompleted, activeQuestId });
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
        const res = await apiFetch(`${API_BASE}/api/quests/progress`);
        if (!res.ok) {
          // T1330 (stale premise corrected T7840-followup 2026-08-27): App.jsx
          // hard-gates the entire app to <SignInScreen /> for unauthenticated
          // users, so nothing ever renders this zero-progress state pre-login —
          // this only short-circuits a stray 401 raced during the auth-bootstrap
          // window, avoiding a console warning, not an onboarding UI.
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
    const res = await apiFetch(`${API_BASE}/api/quests/${questId}/claim-reward`, {
      method: 'POST',
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
    apiFetch(`${API_BASE}/api/quests/achievements/${key}`, {
      method: 'POST',
      keepalive: true,
      // T7730: achievements fire from lifecycle triggers (e.g. `returned_home`
      // on Home-screen mount for any account whose quest_1 is already complete),
      // not always a user gesture — this must not arm the "could not save to the
      // cloud" alarm on a passive load. Matches the sibling lifecycle-write
      // marker every other reconciliation/lifecycle call site carries (T6020).
      rbNonDataWrite: true,
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
    _recordedAchievements.clear();
    set({
      definitions: QUEST_DEFINITIONS,
      quests: [],
      loaded: false,
      totalCompleted: 0,
      totalSteps: _totalSteps,
      activeQuestId: null,
      detectionAssignProgress: null,
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
