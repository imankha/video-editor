import { create } from 'zustand';

/**
 * reelPreviewStore (T8530) — EPHEMERAL view state for the draft preview player.
 *
 * Holds a single `payload` SNAPSHOT (built at open time by finishedReelNav) that
 * the top-level <DraftReelPreview /> renders into a CollectionPlayer. It is a
 * snapshot on purpose: publish archives the project, so fetchProjects drops the
 * source row from projectsStore — a store lookup would unmount the player the
 * moment publish succeeds. The snapshot outlives its source row by design.
 *
 * NEVER persisted (no SQLite/R2 write). Mirrors galleryStore.open()'s open/close
 * shape so callers can open the surface from anywhere without prop drilling.
 */
export const useReelPreviewStore = create((set) => ({
  payload: null,
  open: (payload) => set({ payload }),
  close: () => set({ payload: null }),
}));
