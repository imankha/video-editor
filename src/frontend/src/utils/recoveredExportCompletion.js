import { useFocusCompletionStore } from '../stores/focusCompletionStore';

/**
 * reportRecoveredCompletion (T9285) — the single completion seam for
 * useExportRecovery's 3 completion call sites (WS onComplete, the
 * unacknowledged-jobs loop, checkModalStatusOnce's COMPLETE branch), mirroring
 * the one-shot `fireExportComplete` pattern T9740 established for the live
 * path. Framing-only: overlay/annotate completions keep their existing
 * handling (toast via GlobalExportIndicator) and are not routed here.
 *
 * One-shot per job_id via a module-scope Set — the WS and the 60s-silence
 * modal-status re-poll can both report the same job (design §1.5), so this
 * guards the same class of double-delivery `fireExportComplete` guards.
 */
const reportedJobIds = new Set();

export function reportRecoveredCompletion({ jobId, projectId, projectName, type }) {
  if (!jobId || reportedJobIds.has(jobId)) return false;
  reportedJobIds.add(jobId);

  if (type !== 'framing') return false;

  if (!projectId) {
    console.error('[RecoveredExport] framing job with no project_id', jobId);
    return false;
  }

  useFocusCompletionStore.getState().noteRecovered({ jobId, projectId, projectName });
  return true;
}

export function __resetReportedJobsForTest() {
  reportedJobIds.clear();
}
