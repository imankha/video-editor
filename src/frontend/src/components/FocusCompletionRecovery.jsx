import { useEffect, useCallback } from 'react';
import { useFocusCompletionStore } from '../stores/focusCompletionStore';
import { useEditorStore, EDITOR_MODES, useProjectsStore, useQuestStore } from '../stores';
import { useProjectLoader } from '../hooks/useProjectLoader';
import { resolveWorkingVideoPreviewUrl } from '../utils/resolveWorkingVideoPreviewUrl';
import { resumeFocusCompletion } from '../utils/resumeFocusCompletion';
import { toast } from './shared';
import { EXPORT_JOBS } from '../config/displayNames';
import { API_BASE } from '../config';
import apiFetch from '../utils/apiFetch';

/**
 * acknowledgeJob (T9285 §6a) — the framing-specific deferred acknowledge:
 * useExportRecovery's unacknowledged-jobs loop skips this call for a framing
 * job (see useExportRecovery.js), so it fires here instead, on the View or
 * Dismiss gesture. Same endpoint/body shape as the existing mount-time call.
 */
async function acknowledgeJob(jobId) {
  try {
    await apiFetch(`${API_BASE}/api/exports/acknowledge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([jobId]),
    });
  } catch (err) {
    console.error('[FocusCompletionRecovery] Failed to acknowledge job', jobId, err);
  }
}

/**
 * FocusCompletionRecovery (T9285) — the App-level surface for a Focus export
 * that completed via the recovery path (post-reload/tab-discard) with no
 * FocusScreen to show it (design §2.3/§3.3). Renders a small bottom-right
 * card, same visual family as GlobalExportIndicator, with View/Dismiss.
 *
 * Owns its own `useProjectLoader()` call deliberately (design §4): that hook
 * destructures the whole projectDataStore, so calling it from App.jsx (or a
 * hook App calls) would re-render the entire editor tree on every clip-
 * metadata change. A leaf that renders a small card (or null) contains that
 * subscription instead.
 *
 * Option C (approved, design §6/§6a): auto-invokes View when the completion
 * was discovered while the user is still idle on Clips home with nothing
 * selected — the app's own redirect put them there, so restoring the screen
 * is repair, not hijack. Every other case shows the passive card.
 *
 * Also owns the `preview` payload's staleness-scoping guard (review fix,
 * mirroring DraftReelPreview.jsx:45-50). FocusScreen only mounts while
 * editorMode === FRAMING, which is also always the `openMode` this feature
 * stamps — so a guard placed INSIDE FocusScreen can never observe
 * `openMode !== editorMode` (it would already be unmounted). This component
 * is mounted on BOTH `App.jsx` returns (home ~:950, editor ~:1036) — but
 * NOT as one persistent instance: navigating between them unmounts one tree
 * and mounts a fresh one (they are structurally different subtrees, not a
 * single component that stays alive). It is still the right place for the
 * openMode guard, because at least ONE of its two mounts is live for any
 * given screen the user is on, so it can observe the user navigating away
 * (e.g. the mobile back button via `editorStore.setEditorModeFromPopState`,
 * which does not itself clear the preview) and clear the now-orphaned
 * payload before it can resurrect over a live editor on a later, unrelated
 * re-entry. The SAME remount is exactly why the Option C one-shot decision
 * below cannot live in a component-local ref — see `autoTriedJobId` in
 * focusCompletionStore.js.
 */
export function FocusCompletionRecovery() {
  const recovered = useFocusCompletionStore((s) => s.recovered);
  const clearRecovered = useFocusCompletionStore((s) => s.clearRecovered);
  const completionPreview = useFocusCompletionStore((s) => s.preview);
  const openPreview = useFocusCompletionStore((s) => s.openPreview);
  const closePreview = useFocusCompletionStore((s) => s.closePreview);
  const autoTriedJobId = useFocusCompletionStore((s) => s.autoTriedJobId);
  const setAutoTriedJobId = useFocusCompletionStore((s) => s.setAutoTriedJobId);
  // Store-backed, not component-local useState (review polish): a resume
  // kicked off by one mount (e.g. the home tree) must still read as in-flight
  // if the user navigates to the OTHER tree mid-resume — it's the same
  // underlying resumeFocusCompletion call either way, and a local flag would
  // silently re-enable View/Dismiss on the fresh mount.
  const resuming = useFocusCompletionStore((s) => s.resuming);
  const setResuming = useFocusCompletionStore((s) => s.setResuming);
  const editorMode = useEditorStore((s) => s.editorMode);
  const selectedProjectId = useProjectsStore((s) => s.selectedProjectId);
  const { loadProject } = useProjectLoader();

  const view = useCallback(async (jobId, projectId) => {
    if (useFocusCompletionStore.getState().resuming) return; // already in flight
    setResuming(true);
    try {
      const result = await resumeFocusCompletion(
        { jobId, projectId },
        {
          getEditorMode: () => useEditorStore.getState().editorMode,
          getSelectedProjectId: () => useProjectsStore.getState().selectedProjectId,
          selectProject: (id) => useProjectsStore.getState().selectProject(id),
          setEditorMode: (mode) => useEditorStore.getState().setEditorMode(mode),
          loadProject,
          // Mirrors FocusScreen.jsx's live completion path (refreshProject
          // before resolving the preview URL) — same underlying store action
          // FocusScreen's own `useProject().refresh` calls.
          refreshProject: () => useProjectsStore.getState().refreshSelectedProject(),
          resolvePreviewUrl: resolveWorkingVideoPreviewUrl,
          openPreview,
          acknowledgeJob,
          recordAchievement: (id) => useQuestStore.getState().recordAchievement(id),
          toastError: (title, opts) => toast.error(title, opts),
          EDITOR_MODES,
        },
      );
      // Only clear the card on a SUCCESSFUL resume. resumeFocusCompletion
      // already toasted the failure; leaving the card up (instead of
      // deleting the user's only affordance) lets them retry View without
      // waiting for the job to resurface on a future reload — the job stays
      // unacknowledged either way, so nothing is lost either path.
      if (result.opened) clearRecovered();
    } catch (err) {
      // resumeFocusCompletion already catches its own failures and reports
      // them (loud log + toast); this is a last-resort net so a bug in the
      // wiring above can never surface as an unhandled rejection — the auto-
      // open effect below calls `view()` with no attached `.catch()`. Leave
      // the card up here too, for the same retry reason as the `else` above.
      console.error('[FocusCompletionRecovery] view() failed unexpectedly', err);
    } finally {
      setResuming(false);
    }
  }, [loadProject, openPreview, clearRecovered, setResuming]);

  // Option C auto-open: only when idle on home with nothing selected. The
  // decision is made ONCE, at first observation of a given job — claimed in
  // focusCompletionStore (survives this component's remount between the home
  // and editor trees, see class doc) BEFORE the idle-on-home check, not after
  // it passes. Claiming it only on a pass meant a job discovered while the
  // user was elsewhere (shows the passive card, correctly) would still be
  // "untried" the NEXT time the user happened to land back on home with
  // nothing selected — even if that later visit was the user's own
  // deliberate navigation (or, pre-fix, just a remount from switching
  // screens), not the app's redirect. That retroactively promoted a
  // passive-card case into a hijack, exactly what Option C exists to avoid.
  useEffect(() => {
    if (!recovered) return;
    if (autoTriedJobId === recovered.jobId) return;
    setAutoTriedJobId(recovered.jobId);
    const idleOnHome = editorMode === EDITOR_MODES.PROJECT_MANAGER && !selectedProjectId;
    if (!idleOnHome) return;
    view(recovered.jobId, recovered.projectId);
  }, [recovered, editorMode, selectedProjectId, view, autoTriedJobId, setAutoTriedJobId]);

  // Staleness-scoping guard for the `preview` payload (see class doc above).
  useEffect(() => {
    if (completionPreview && completionPreview.openMode !== editorMode) {
      closePreview();
    }
  }, [completionPreview, editorMode, closePreview]);

  if (!recovered) return null;

  const handleDismiss = async () => {
    if (useFocusCompletionStore.getState().resuming) return; // in-flight guard, mirrors view()
    setResuming(true);
    try {
      await acknowledgeJob(recovered.jobId);
      clearRecovered();
    } finally {
      setResuming(false);
    }
  };

  return (
    // T9285: stacked ABOVE GlobalExportIndicator's bottom-4/right-4 slot (design
    // §5 risk: "two bottom-right surfaces collide") so a concurrent export
    // indicator never renders on top of this card.
    <div className="fixed bottom-24 right-4 z-40" data-testid="focus-completion-recovery">
      <div className="bg-gray-800 border border-gray-600 rounded-lg shadow-xl px-4 py-3 w-64">
        <div className="text-sm font-medium text-white">{EXPORT_JOBS.framing.completed}</div>
        <div className="text-xs text-gray-400 truncate mb-3">{recovered.projectName || 'Your reel'}</div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => view(recovered.jobId, recovered.projectId)}
            disabled={resuming}
            className="flex-1 px-3 py-1.5 rounded-md text-xs font-medium bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50"
          >
            View
          </button>
          <button
            type="button"
            onClick={handleDismiss}
            disabled={resuming}
            className="px-3 py-1.5 rounded-md text-xs font-medium border border-gray-600 text-gray-300 hover:bg-gray-700 disabled:opacity-50"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}

export default FocusCompletionRecovery;
