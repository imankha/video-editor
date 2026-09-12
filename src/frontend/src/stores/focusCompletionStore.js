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
 *  - `autoTriedJobId`: the job_id Option C has already made its one auto-open
 *    decision for (or null). Lives HERE, not in a `FocusCompletionRecovery`
 *    `useRef` (review finding, T9285) — `App.jsx` mounts that component in TWO
 *    structurally different trees (home return vs. editor return), so
 *    navigating between them unmounts one instance and mounts a fresh one,
 *    resetting any component-local ref. A job discovered while the user was
 *    elsewhere (correctly passive) would then re-evaluate as "first
 *    observation" on the very next home<->editor navigation and could
 *    auto-open — exactly the hijack Option C exists to prevent. Store state
 *    survives that remount.
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

  autoTriedJobId: null,
  setAutoTriedJobId: (jobId) => set({ autoTriedJobId: jobId }),

  // Also survives the same remount `autoTriedJobId` does: a resume kicked off
  // by the home-tree mount must still show as "in flight" (View/Dismiss
  // disabled) if the user navigates to the editor tree mid-resume, since it's
  // the SAME underlying resumeFocusCompletion call touching shared stores
  // either way — a component-local flag would silently re-enable both
  // buttons on the fresh mount.
  resuming: false,
  setResuming: (resuming) => set({ resuming }),
}));
