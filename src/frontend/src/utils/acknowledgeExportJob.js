import apiFetch from './apiFetch';
import { API_BASE } from '../config';

/**
 * acknowledgeExportJob (T9285 §6a, extracted T9790) — the framing-specific
 * deferred acknowledge: useExportRecovery's unacknowledged-jobs loop skips the
 * `POST /api/exports/acknowledge` call for a COMPLETE framing job, so it must
 * fire from a real completion GESTURE instead. Two families of callers share
 * this one implementation:
 *  - the recovered path — FocusCompletionRecovery's View (via
 *    resumeFocusCompletion) and Dismiss;
 *  - the live path — FocusScreen's four post-preview gesture handlers (Add
 *    Spotlight, Add Spotlight Later, Publish, Refocus), which before T9790
 *    never acknowledged at all, so every live completion sat unacknowledged in
 *    the DB for the full 24h window and re-prompted as "recoverable" on any
 *    reload.
 *
 * Only `acknowledged_at` is written server-side — no draft/media/job-history
 * field is touched. A failure logs loudly and is swallowed (the job simply
 * stays unacknowledged and re-prompts next load — the deliberate §6a property,
 * never a lost draft).
 */
export async function acknowledgeExportJob(jobId) {
  try {
    await apiFetch(`${API_BASE}/api/exports/acknowledge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([jobId]),
    });
  } catch (err) {
    console.error('[acknowledgeExportJob] Failed to acknowledge job', jobId, err);
  }
}

export default acknowledgeExportJob;
