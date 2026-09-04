import { create } from 'zustand';

/**
 * publishIntentStore (T8390) — ephemeral cross-component signal for Focus's
 * one-tap Publish. FocusScreen's Publish action fires the (spotlight-less)
 * overlay render and records the project id it did that FOR; the shared
 * export-completion handler (App.jsx handleExportComplete, the same "T8530:
 * land the user on the finished reel" block) reads + clears it to auto-run the
 * publish gesture instead of just opening the finished-reel preview. This is
 * the "publishAfterRenderRef" mechanism from the approved T8390 design — a
 * store (not a plain React ref) because the writer (FocusScreen) and the
 * reader (App.jsx) are different components with no ref-passing relationship.
 *
 * NEVER persisted (no SQLite/R2 write) — mirrors reelPreviewStore's shape.
 */
export const usePublishIntentStore = create((set) => ({
  projectId: null,
  set: (projectId) => set({ projectId }),
  clear: () => set({ projectId: null }),
}));
