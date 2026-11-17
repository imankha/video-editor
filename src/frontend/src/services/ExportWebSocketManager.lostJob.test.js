import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ExportWebSocketManager } from './ExportWebSocketManager';
import { useExportStore } from '../stores/exportStore';
import { ERROR_COPY } from '../config/displayNames';
import { exportFailureCopy } from '../utils/userError';

/**
 * T16830: a sharpen lost to a server restart leaves no export job on the server. The socket
 * reconnects to the new process, which never sends anything for a job it does not know, and
 * GET /api/exports/{id} answers 404. Frame must stop waiting within a minute and tell the
 * parent to sharpen again, instead of showing progress forever.
 */

class SilentSocket {
  static OPEN = 1;
  constructor() {
    this.readyState = 0;
    setTimeout(() => {
      this.readyState = SilentSocket.OPEN;
      this.onopen?.();
    }, 0);
  }
  send() {}
  close() {
    this.readyState = 3;
  }
}

describe('ExportWebSocketManager: a job the server no longer has (T16830)', () => {
  const exportId = 'export_t16830';
  let manager;
  let statusCode;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', SilentSocket);
    statusCode = 404;
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: statusCode === 200,
      status: statusCode,
      json: async () => ({ job_id: exportId, status: 'processing' }),
    })));
    useExportStore.getState().reset();
    useExportStore.getState().startExport(exportId, 7, 'framing', 'Brilliant Goal');
    manager = new ExportWebSocketManager();
  });

  afterEach(() => {
    manager.disconnectAll();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('fails a silent export within a minute when the server 404s it, telling the parent to sharpen again', async () => {
    const onError = vi.fn();
    manager.connect(exportId, { onError });
    await vi.advanceTimersByTimeAsync(60000);

    const exp = useExportStore.getState().activeExports[exportId];
    expect(exp.status).toBe('error');
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][1]).toMatchObject({ code: 'export_lost' });
    expect(exportFailureCopy(exp)).toBe(ERROR_COPY.SHARPEN_INTERRUPTED);
    expect(exportFailureCopy({ ...onError.mock.calls[0][1], type: 'framing' })).toBe(ERROR_COPY.SHARPEN_INTERRUPTED);
  });

  it('keeps waiting while the server still has the job', async () => {
    statusCode = 200;
    const onError = vi.fn();
    manager.connect(exportId, { onError });
    await vi.advanceTimersByTimeAsync(120000);

    expect(useExportStore.getState().activeExports[exportId].status).not.toBe('error');
    expect(onError).not.toHaveBeenCalled();
  });

  it('does not fail on a single 404 (the render request may not have created the row yet)', async () => {
    const onError = vi.fn();
    manager.connect(exportId, { onError });
    await vi.advanceTimersByTimeAsync(16000);
    statusCode = 200;
    await vi.advanceTimersByTimeAsync(60000);

    expect(useExportStore.getState().activeExports[exportId].status).not.toBe('error');
    expect(onError).not.toHaveBeenCalled();
  });

  it('periodic REST polling stops on a lost job instead of polling forever', async () => {
    const onError = vi.fn();
    manager.connections.set(exportId, { callbacks: { onError }, reconnectAttempt: 10, reconnectTimeout: null });
    manager._startPeriodicPolling(exportId, { onError });
    await vi.advanceTimersByTimeAsync(30000);

    expect(useExportStore.getState().activeExports[exportId].status).toBe('error');
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
