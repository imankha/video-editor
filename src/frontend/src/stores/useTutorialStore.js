import { create } from 'zustand';

export const useTutorialStore = create((set) => ({
  openQuestId: null,
  openTutorial: (questId) => set({ openQuestId: questId }),
  closeTutorial: () => set({ openQuestId: null }),
}));
