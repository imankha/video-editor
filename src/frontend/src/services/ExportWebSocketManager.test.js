import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ExportWebSocketManager } from './ExportWebSocketManager';
import { useExportStore } from '../stores/exportStore';

/**
 * T11330: the preflight cost guard (T11320) rejects an over-budget export inside a
 * BACKGROUND task, so the rejection never reaches an HTTP client — it arrives only over the
 * export progress WebSocket as a terminal ERROR frame whose top level carries the structured
 * `export_too_large` detail (export_cost_guard.to_error_detail() merged into the error frame,
 * see multi_clip._export_clips). These tests drive the REAL WS message handler (the same
 * parser a live socket feeds) and prove that frame is routed into the store as a
 * `budgetRejection` the explanatory popup can render — NOT a fabricated HTTP error.
 */

// A faithful copy of the backend error frame for a Bug-58p-shaped rejection: error_data
// (multi_clip.py) with budget_detail (export_cost_guard.to_error_detail()) merged in.
function budgetRejectionFrame(overrides = {}) {
  return JSON.stringify({
    progress: 0,
    status: 'error',
    recoverable: false,
    message: 'This export needs an estimated 4200s of GPU time, over the 2880s safe limit.',
    error: 'This export needs an estimated 4200s of GPU time, over the 2880s safe limit.',
    code: 'export_too_large',
    estimated_gpu_seconds: 4200.0,
    budget_seconds: 2880.0,
    modal_timeout_seconds: 3600.0,
    budget_fraction: 0.8,
    biggest_contributors: [
      { clip_index: 3, clip_name: 'Clip 4', frame_count: 170, crop_width: 1920, crop_height: 1080, estimated_gpu_seconds: 800.0 },
      { clip_index: 1, clip_name: 'Clip 2', frame_count: 170, crop_width: 1920, crop_height: 1080, estimated_gpu_seconds: 800.0 },
    ],
    ...overrides,
  });
}

describe('ExportWebSocketManager — T11320 over-budget rejection over the WS channel (T11330)', () => {
  let manager;
  const exportId = 'export_t11330';

  beforeEach(() => {
    useExportStore.getState().reset();
    manager = new ExportWebSocketManager();
    // The export is registered before its socket connects, exactly as in production
    // (startExport runs before ExportWebSocketManager.connect).
    useExportStore.getState().startExport(exportId, 7, 'framing', 'Brilliant Goal');
  });

  it('routes an export_too_large error frame into the store as a raw budgetRejection', () => {
    manager._handleMessage(exportId, budgetRejectionFrame(), {});

    const exp = useExportStore.getState().activeExports[exportId];
    expect(exp.status).toBe('error');
    // The structured guard payload is stored raw so the popup can render the why + levers.
    expect(exp.budgetRejection).toBeTruthy();
    expect(exp.budgetRejection.code).toBe('export_too_large');
    expect(exp.budgetRejection.estimated_gpu_seconds).toBe(4200.0);
    expect(exp.budgetRejection.biggest_contributors[0].crop_width).toBe(1920);
    expect(exp.budgetRejection.biggest_contributors[0].clip_name).toBe('Clip 4');
  });

  it('marks the rejection NOT retryable (the same export always exceeds budget)', () => {
    manager._handleMessage(exportId, budgetRejectionFrame(), {});
    expect(useExportStore.getState().activeExports[exportId].retryable).toBe(false);
  });

  it('still fires the onError callback and emits the error event with the full payload', () => {
    const onError = vi.fn();
    const emitted = vi.fn();
    manager.addEventListener('*', 'error', emitted);

    manager._handleMessage(exportId, budgetRejectionFrame(), { onError });

    expect(onError).toHaveBeenCalledTimes(1);
    // onError carries the code so any callback-side handling can branch on it.
    expect(onError.mock.calls[0][1]).toMatchObject({ code: 'export_too_large' });
    expect(emitted).toHaveBeenCalledTimes(1);
    expect(emitted.mock.calls[0][0]).toMatchObject({ code: 'export_too_large' });
  });

  it('leaves budgetRejection null for an ordinary (non-guard) export failure', () => {
    manager._handleMessage(
      exportId,
      JSON.stringify({ status: 'error', error: 'Network error during export' }),
      {}
    );
    const exp = useExportStore.getState().activeExports[exportId];
    expect(exp.status).toBe('error');
    expect(exp.budgetRejection).toBeNull();
  });
});
