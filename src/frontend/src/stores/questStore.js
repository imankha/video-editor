import { create } from 'zustand';
import { API_BASE } from '../config';
import { QUESTS, TOTAL_STEPS } from '../config/questDefinitions';
import { useCreditStore } from './creditStore';
import { useGalleryStore } from './galleryStore';

/**
 * Quest Store — manages quest progress, overlay state, and reward claiming (T540).
 *
 * The quest overlay auto-shows for users who haven't completed all quests.
 * Users can dismiss it, and re-open via the header QuestIcon.
 * Progressive disclosure: shows Quest 1 first, reveals Quest 2 after Quest 1 is claimed.
 */
export const useQuestStore = create((set, get) => ({
  // Overlay state
  isOpen: false,
  dismissed: false,  // User explicitly closed — don't auto-reopen until next session

  // Quest progress from backend
  quests: [],          // [{id, steps: {step_id: bool}, completed: bool, reward_claimed: bool}]
  loaded: false,

  // Derived totals (computed on fetch)
  totalCompleted: 0,
  totalSteps: TOTAL_STEPS,

  // Which quest is currently active (progressive disclosure)
  // null = auto-detect, 'quest_1' or 'quest_2'
  activeQuestId: null,

  // Open/close — opening closes Gallery (mutual exclusion)
  open: () => {
    useGalleryStore.getState().close();
    set({ isOpen: true, dismissed: false });
  },
  close: () => set({ isOpen: false, dismissed: true }),
  toggle: () => {
    const { isOpen } = get();
    if (!isOpen) {
      useGalleryStore.getState().close();
    }
    set({ isOpen: !isOpen, dismissed: isOpen ? true : false });
  },

  fetchProgress: async () => {
    try {
      const res = await fetch(`${API_BASE}/api/quests/progress`, { credentials: 'include' });
      if (!res.ok) return;
      const data = await res.json();

      // Compute totals
      let totalCompleted = 0;
      for (const quest of data.quests) {
        totalCompleted += Object.values(quest.steps).filter(Boolean).length;
      }

      // Determine active quest (progressive disclosure)
      const q1 = data.quests.find(q => q.id === 'quest_1');
      const q2 = data.quests.find(q => q.id === 'quest_2');
      let activeQuestId = 'quest_1';
      if (q1?.reward_claimed) {
        activeQuestId = 'quest_2';
      }

      const { dismissed, isOpen } = get();
      const allDone = totalCompleted === TOTAL_STEPS && q1?.reward_claimed && q2?.reward_claimed;

      set({
        quests: data.quests,
        loaded: true,
        totalCompleted,
        activeQuestId,
      });

      // Auto-show for users who haven't dismissed and haven't completed everything
      if (!dismissed && !isOpen && !allDone) {
        set({ isOpen: true });
      }
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

    // Update credit store
    useCreditStore.getState().setBalance(data.new_balance);

    // Refresh quest progress (will auto-advance activeQuestId)
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
    isOpen: false,
    dismissed: false,
    quests: [],
    loaded: false,
    totalCompleted: 0,
    activeQuestId: null,
  }),
}));

// Selector hooks
export const useQuestIsOpen = () => useQuestStore((s) => s.isOpen);
export const useQuestProgress = () => useQuestStore((s) => ({
  quests: s.quests,
  loaded: s.loaded,
  totalCompleted: s.totalCompleted,
  totalSteps: s.totalSteps,
}));
