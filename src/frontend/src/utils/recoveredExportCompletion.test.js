import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reportRecoveredCompletion, __resetReportedJobsForTest } from './recoveredExportCompletion';
import { useFocusCompletionStore } from '../stores/focusCompletionStore';

// T9285 — the recovery path's single completion seam (design §2.3b). Collapses
// useExportRecovery's 3 completion call sites (WS onComplete, unacknowledged
// loop, checkModalStatusOnce COMPLETE) into one helper, mirroring the
// fireExportComplete one-shot pattern T9740 established for the live path.

describe('reportRecoveredCompletion (T9285)', () => {
  beforeEach(() => {
    __resetReportedJobsForTest();
    useFocusCompletionStore.getState().clearRecovered();
    vi.restoreAllMocks();
  });

  it('notes a framing completion in focusCompletionStore and returns true', () => {
    const result = reportRecoveredCompletion({
      jobId: 'job-1', projectId: 42, projectName: 'My Reel', type: 'framing',
    });

    expect(result).toBe(true);
    expect(useFocusCompletionStore.getState().recovered).toEqual({
      jobId: 'job-1', projectId: 42, projectName: 'My Reel',
    });
  });

  it('ignores overlay completions — that type owns its own completion handling', () => {
    const result = reportRecoveredCompletion({
      jobId: 'job-2', projectId: 42, projectName: 'My Reel', type: 'overlay',
    });

    expect(result).toBe(false);
    expect(useFocusCompletionStore.getState().recovered).toBeNull();
  });

  it('ignores annotate completions', () => {
    const result = reportRecoveredCompletion({
      jobId: 'job-3', projectId: 42, projectName: 'My Reel', type: 'annotate',
    });

    expect(result).toBe(false);
    expect(useFocusCompletionStore.getState().recovered).toBeNull();
  });

  it('one-shot per job_id: a second delivery of the same jobId (WS + modal-poll double delivery) is a no-op', () => {
    const first = reportRecoveredCompletion({ jobId: 'job-4', projectId: 1, projectName: 'A', type: 'framing' });
    useFocusCompletionStore.getState().clearRecovered();
    const second = reportRecoveredCompletion({ jobId: 'job-4', projectId: 1, projectName: 'A', type: 'framing' });

    expect(first).toBe(true);
    expect(second).toBe(false);
    // The second delivery must not re-note anything, even though the store was cleared.
    expect(useFocusCompletionStore.getState().recovered).toBeNull();
  });

  it('latest wins: a second DIFFERENT job overwrites the previously noted one', () => {
    reportRecoveredCompletion({ jobId: 'job-5', projectId: 1, projectName: 'A', type: 'framing' });
    reportRecoveredCompletion({ jobId: 'job-6', projectId: 2, projectName: 'B', type: 'framing' });

    expect(useFocusCompletionStore.getState().recovered).toEqual({
      jobId: 'job-6', projectId: 2, projectName: 'B',
    });
  });

  it('loud console.error (not a silent return) on a framing job missing project_id, and does not note it', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = reportRecoveredCompletion({ jobId: 'job-7', projectId: null, projectName: null, type: 'framing' });

    expect(result).toBe(false);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toMatch(/framing job with no project_id/i);
    expect(useFocusCompletionStore.getState().recovered).toBeNull();
  });

  it('ignores a call with no jobId at all', () => {
    const result = reportRecoveredCompletion({ jobId: null, projectId: 1, projectName: 'A', type: 'framing' });
    expect(result).toBe(false);
    expect(useFocusCompletionStore.getState().recovered).toBeNull();
  });
});
