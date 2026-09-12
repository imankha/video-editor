import { create } from 'zustand';

/**
 * focusCompletionStore (T9285) — ephemeral cross-component state for Focus's
 * post-export completion preview, mirroring publishIntentStore.js's shape.
 *
 * Two independent slices:
 *  - `preview`: the open completion preview ({ projectId, previewUrl, openMode }
 *    or null). Written by BOTH the live completion path (FocusScreen, still
 *    mounted) and the recovered path (resumeFocusCompletion, after a reload) —
 *    `openPreview` has exactly two callers and FocusScreen is the one renderer,
 *    so the two paths converge on the same CollectionPlayer + FocusPublishActionBar
 *    instead of duplicating it (design §2.2).
 *  - `recovered`: a completion discovered by useExportRecovery that no
 *    FocusScreen owned ({ jobId, projectId, projectName } or null), surfaced by
 *    FocusCompletionRecovery until the user Views or Dismisses it.
 *
 * NEVER persisted (no SQLite/R2 write, no localStorage/sessionStorage) — dies
 * with the tab like every other store in this family. The durable anchor this
 * feature reads from is the server's export_jobs.acknowledged_at, not this store.
 */
export const useFocusCompletionStore = create((set) => ({
  preview: null,
  openPreview: ({ projectId, previewUrl, openMode }) => set({ preview: { projectId, previewUrl, openMode } }),
  closePreview: () => set({ preview: null }),

  recovered: null,
  noteRecovered: ({ jobId, projectId, projectName }) => set({ recovered: { jobId, projectId, projectName } }),
  clearRecovered: () => set({ recovered: null }),
}));
