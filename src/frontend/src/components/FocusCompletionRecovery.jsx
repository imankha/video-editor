import { useState, useEffect, useRef, useCallback } from 'react';
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
 */
export function FocusCompletionRecovery() {
  const recovered = useFocusCompletionStore((s) => s.recovered);
  const clearRecovered = useFocusCompletionStore((s) => s.clearRecovered);
  const openPreview = useFocusCompletionStore((s) => s.openPreview);
  const editorMode = useEditorStore((s) => s.editorMode);
  const selectedProjectId = useProjectsStore((s) => s.selectedProjectId);
  const { loadProject } = useProjectLoader();
  const [resuming, setResuming] = useState(false);
  const autoTriedJobIdRef = useRef(null);

  const view = useCallback(async (jobId, projectId) => {
    setResuming(true);
    try {
      await resumeFocusCompletion(
        { jobId, projectId },
        {
          getEditorMode: () => useEditorStore.getState().editorMode,
          getSelectedProjectId: () => useProjectsStore.getState().selectedProjectId,
          selectProject: (id) => useProjectsStore.getState().selectProject(id),
          setEditorMode: (mode) => useEditorStore.getState().setEditorMode(mode),
          loadProject,
          resolvePreviewUrl: resolveWorkingVideoPreviewUrl,
          openPreview,
          acknowledgeJob,
          recordAchievement: (id) => useQuestStore.getState().recordAchievement(id),
          toastError: (title, opts) => toast.error(title, opts),
          EDITOR_MODES,
        },
      );
    } finally {
      clearRecovered();
      setResuming(false);
    }
  }, [loadProject, openPreview, clearRecovered]);

  // Option C auto-open: only when idle on home with nothing selected, and only
  // once per recovered job (a dismissed/viewed job clears `recovered`, so this
  // never re-fires for the same completion).
  useEffect(() => {
    if (!recovered) return;
    if (autoTriedJobIdRef.current === recovered.jobId) return;
    const idleOnHome = editorMode === EDITOR_MODES.PROJECT_MANAGER && !selectedProjectId;
    if (!idleOnHome) return;
    autoTriedJobIdRef.current = recovered.jobId;
    view(recovered.jobId, recovered.projectId);
  }, [recovered, editorMode, selectedProjectId, view]);

  if (!recovered) return null;

  const handleDismiss = async () => {
    await acknowledgeJob(recovered.jobId);
    clearRecovered();
  };

  return (
    <div className="fixed bottom-4 right-4 z-40" data-testid="focus-completion-recovery">
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
