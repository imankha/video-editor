import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useExportRecovery } from './useExportRecovery';
import { useFocusCompletionStore } from '../stores/focusCompletionStore';
import { __resetReportedJobsForTest } from '../utils/recoveredExportCompletion';

// T9285 — the recovery path's unacknowledged-jobs loop must carry a FRAMING
// completion into focusCompletionStore (design §2.2/§2.4), where today it is a
// total no-op (exportStore.completeExport is a silent no-op for a job that was
// never in activeExports — design §1.3). This is also the RED-STATE proof for
// AC1 (mechanism confirmed) on master: before the fix, `recovered` never gets
// set for the framing job below, and the acknowledge POST fires for it exactly
// as it does for every other job (no deferred-acknowledge split, §6a).

vi.mock('../utils/sessionInit', () => ({
  initSession: vi.fn(async () => ({ isAuthenticated: true, profileReady: Promise.resolve() })),
}));

const apiFetchMock = vi.fn();
vi.mock('../utils/apiFetch', () => ({ default: (...args) => apiFetchMock(...args) }));

const { wsConnectMock } = vi.hoisted(() => ({ wsConnectMock: vi.fn(async () => ({ connected: true })) }));
vi.mock('../services/ExportWebSocketManager', () => ({
  default: { connect: (...args) => wsConnectMock(...args), disconnect: vi.fn() },
}));

function jsonResponse(body) {
  return { ok: true, json: async () => body };
}

describe('useExportRecovery (T9285 recovery-path completion routing)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    apiFetchMock.mockReset();
    wsConnectMock.mockReset();
    wsConnectMock.mockResolvedValue({ connected: true });
    __resetReportedJobsForTest();
    useFocusCompletionStore.getState().clearRecovered();
    delete window.__bootstrapExports;
  });

  it('an unacknowledged FRAMING completion is noted in focusCompletionStore; acknowledge is DEFERRED (not sent at mount time)', async () => {
    window.__bootstrapExports = {
      active: [],
      unacknowledged: [
        { job_id: 'job-framing-1', project_id: 42, project_name: 'My Reel', type: 'framing', status: 'complete', output_video_id: 7, output_filename: 'out.mp4' },
      ],
    };
    apiFetchMock.mockResolvedValue(jsonResponse({ acknowledged: 0 }));

    renderHook(() => useExportRecovery());

    await waitFor(() => {
      expect(useFocusCompletionStore.getState().recovered).toEqual({
        jobId: 'job-framing-1', projectId: 42, projectName: 'My Reel',
      });
    });

    // §6a: the framing job's acknowledge is deferred to the View/Dismiss
    // gesture — the mount-time reconciliation must NOT acknowledge it.
    const ackCalls = apiFetchMock.mock.calls.filter(([url]) => String(url).includes('/api/exports/acknowledge'));
    for (const [, opts] of ackCalls) {
      const body = JSON.parse(opts.body);
      expect(body).not.toContain('job-framing-1');
    }
  });

  it('an unacknowledged OVERLAY completion is NOT noted (overlay owns its own completion handling) and keeps the unconditional mount-time acknowledge', async () => {
    window.__bootstrapExports = {
      active: [],
      unacknowledged: [
        { job_id: 'job-overlay-1', project_id: 43, project_name: 'Other Reel', type: 'overlay', status: 'complete', output_video_id: 8, output_filename: 'out2.mp4' },
      ],
    };
    apiFetchMock.mockResolvedValue(jsonResponse({ acknowledged: 1 }));

    renderHook(() => useExportRecovery());

    await waitFor(() => {
      const ackCalls = apiFetchMock.mock.calls.filter(([url]) => String(url).includes('/api/exports/acknowledge'));
      expect(ackCalls.length).toBeGreaterThan(0);
    });

    expect(useFocusCompletionStore.getState().recovered).toBeNull();
    const ackCalls = apiFetchMock.mock.calls.filter(([url]) => String(url).includes('/api/exports/acknowledge'));
    const acknowledgedIds = ackCalls.flatMap(([, opts]) => JSON.parse(opts.body));
    expect(acknowledgedIds).toContain('job-overlay-1');
  });

  it('mixed batch: framing job deferred, overlay job acknowledged immediately, in the SAME mount', async () => {
    window.__bootstrapExports = {
      active: [],
      unacknowledged: [
        { job_id: 'job-framing-2', project_id: 42, project_name: 'My Reel', type: 'framing', status: 'complete', output_video_id: 7, output_filename: 'out.mp4' },
        { job_id: 'job-overlay-2', project_id: 43, project_name: 'Other Reel', type: 'overlay', status: 'complete', output_video_id: 8, output_filename: 'out2.mp4' },
      ],
    };
    apiFetchMock.mockResolvedValue(jsonResponse({ acknowledged: 1 }));

    renderHook(() => useExportRecovery());

    await waitFor(() => {
      expect(useFocusCompletionStore.getState().recovered?.jobId).toBe('job-framing-2');
    });

    const ackCalls = apiFetchMock.mock.calls.filter(([url]) => String(url).includes('/api/exports/acknowledge'));
    const acknowledgedIds = ackCalls.flatMap(([, opts]) => JSON.parse(opts.body));
    expect(acknowledgedIds).toContain('job-overlay-2');
    expect(acknowledgedIds).not.toContain('job-framing-2');
  });

  it('checkModalStatusOnce COMPLETE branch (active PENDING job finished on Modal while away) routes a framing job into focusCompletionStore', async () => {
    window.__bootstrapExports = {
      active: [
        { job_id: 'job-modal-1', project_id: 44, project_name: 'Modal Reel', type: 'framing', status: 'pending' },
      ],
      unacknowledged: [],
    };
    apiFetchMock.mockImplementation(async (url) => {
      if (String(url).includes('/modal-status')) {
        return jsonResponse({ status: 'complete', working_video_id: 9, output_filename: 'm.mp4' });
      }
      return jsonResponse({ acknowledged: 0 });
    });

    renderHook(() => useExportRecovery());

    await waitFor(() => {
      expect(useFocusCompletionStore.getState().recovered).toEqual({
        jobId: 'job-modal-1', projectId: 44, projectName: 'Modal Reel',
      });
    });
    // A still-running/complete-on-Modal job never went through the
    // unacknowledged loop, so it must not fire an acknowledge POST here.
    expect(wsConnectMock).not.toHaveBeenCalled();
  });

  it('WS onComplete callback (still-mounted recovery WS connection) routes a framing job into focusCompletionStore', async () => {
    window.__bootstrapExports = {
      active: [
        { job_id: 'job-ws-1', project_id: 45, project_name: 'WS Reel', type: 'framing', status: 'processing' },
      ],
      unacknowledged: [],
    };
    apiFetchMock.mockImplementation(async (url) => {
      if (String(url).includes('/modal-status')) {
        return jsonResponse({ status: 'running' });
      }
      return jsonResponse({ acknowledged: 0 });
    });
    let capturedOnComplete = null;
    wsConnectMock.mockImplementation(async (jobId, handlers) => {
      capturedOnComplete = handlers.onComplete;
      return { connected: true };
    });

    renderHook(() => useExportRecovery());

    await waitFor(() => expect(capturedOnComplete).toBeTypeOf('function'));

    // Simulate the WS delivering the completion frame for this job. The real
    // callback closes over `exp` from the active-exports loop (mirrors
    // clearSilenceTimeout's existing closure use) rather than a WS payload arg.
    capturedOnComplete();

    await waitFor(() => {
      expect(useFocusCompletionStore.getState().recovered).toEqual({
        jobId: 'job-ws-1', projectId: 45, projectName: 'WS Reel',
      });
    });
  });

  it('no unacknowledged exports: no-op, no crash', async () => {
    window.__bootstrapExports = { active: [], unacknowledged: [] };
    apiFetchMock.mockResolvedValue(jsonResponse({ acknowledged: 0 }));

    renderHook(() => useExportRecovery());

    await waitFor(() => {
      expect(apiFetchMock).not.toHaveBeenCalledWith(expect.stringContaining('/api/exports/acknowledge'), expect.anything());
    });
    expect(useFocusCompletionStore.getState().recovered).toBeNull();
  });
});
