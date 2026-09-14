import { create } from 'zustand';

/**
 * focusCompletionStore (T9285) — ephemeral cross-component state for Focus's
 * post-export completion preview, mirroring publishIntentStore.js's shape.
 *
 * Two independent slices:
 *  - `preview`: the open completion preview ({ projectId, previewUrl, openMode,
 *    jobId } or null). Written by BOTH the live completion path (FocusScreen,
 *    still mounted) and the recovered path (resumeFocusCompletion, after a
 *    reload) — `openPreview` has exactly two callers and FocusScreen is the one
 *    renderer, so the two paths converge on the same CollectionPlayer +
 *    FocusPublishActionBar instead of duplicating it (design §2.2). `jobId`
 *    (T9790) is the completed framing job's id, carried so FocusScreen's four
 *    post-preview gesture handlers can acknowledge it on the decision gesture.
 *  - `recovered`: a completion discovered by useExportRecovery that no
 *    FocusScreen owned ({ jobId, projectId, projectName } or null), surfaced by
 *    FocusCompletionRecovery until the user Views or Dismisses it.
 *
 * T9790: the Option-C auto-navigate was removed (it clobbered a deliberate cold
 * reload onto the library), so the `autoTriedJobId` one-shot guard it needed is
 * gone too — FocusCompletionRecovery now only ever shows the passive card.
 *
 * NEVER persisted (no SQLite/R2 write, no localStorage/sessionStorage) — dies
 * with the tab like every other store in this family. The durable anchor this
 * feature reads from is the server's export_jobs.acknowledged_at, not this store.
 */
export const useFocusCompletionStore = create((set) => ({
  preview: null,
  openPreview: ({ projectId, previewUrl, openMode, jobId }) => set({ preview: { projectId, previewUrl, openMode, jobId } }),
  closePreview: () => set({ preview: null }),

  recovered: null,
  noteRecovered: ({ jobId, projectId, projectName }) => set({ recovered: { jobId, projectId, projectName } }),
  clearRecovered: () => set({ recovered: null }),

  // Survives the FocusCompletionRecovery remount (App.jsx mounts it in two
  // structurally different trees): a resume kicked off by the home-tree mount
  // must still show as "in flight" (View/Dismiss disabled) if the user
  // navigates to the editor tree mid-resume, since it's the SAME underlying
  // resumeFocusCompletion call touching shared stores either way — a
  // component-local flag would silently re-enable both buttons on the fresh
  // mount.
  resuming: false,
  setResuming: (resuming) => set({ resuming }),
}));
