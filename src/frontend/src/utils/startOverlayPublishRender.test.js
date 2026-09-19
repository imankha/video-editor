import { describe, it, expect, vi } from 'vitest';
import { startOverlayPublishRender } from './startOverlayPublishRender';
import { HighlightEffect } from '../constants/highlightEffects';

// All collaborators injected so the module runs with no real WS/axios/store.
function makeDeps(overrides = {}) {
  let wsCallbacks = null;
  const deps = {
    startExport: vi.fn(),
    completeExport: vi.fn(),
    failExport: vi.fn(),
    connect: vi.fn(async (_id, cbs) => { wsCallbacks = cbs; return true; }),
    disconnect: vi.fn(),
    post: vi.fn().mockResolvedValue({ status: 202 }),
    generateId: () => 'export_test_1',
    ...overrides,
  };
  return { deps, getWs: () => wsCallbacks };
}

describe('startOverlayPublishRender (T10660)', () => {
  it('registers the job, connects the WS BEFORE the POST, and POSTs the backend-authoritative body', async () => {
    const { deps } = makeDeps();
    await startOverlayPublishRender({ projectId: 7, onComplete: vi.fn(), deps });

    expect(deps.startExport).toHaveBeenCalledWith('export_test_1', 7);
    expect(deps.post).toHaveBeenCalledWith({
      project_id: 7,
      export_id: 'export_test_1',
      effect_type: HighlightEffect.DARK_OVERLAY,
    });
    // Connect must precede the POST so the (possibly immediate) complete frame is heard.
    expect(deps.connect.mock.invocationCallOrder[0]).toBeLessThan(deps.post.mock.invocationCallOrder[0]);
  });

  it('202 background: completion is deferred to the WS frame and then fires exactly once', async () => {
    const onComplete = vi.fn();
    const { deps, getWs } = makeDeps();
    await startOverlayPublishRender({ projectId: 7, onComplete, deps });

    expect(onComplete).not.toHaveBeenCalled();
    getWs().onComplete({ final_video_id: 5 });
    expect(onComplete).toHaveBeenCalledTimes(1);
    // A duplicate WS frame is a no-op (one-shot).
    getWs().onComplete({ final_video_id: 5 });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('DOUBLE DELIVERY (sync 200 + WS complete) fires completion exactly ONCE', async () => {
    const onComplete = vi.fn();
    const { deps, getWs } = makeDeps({
      post: vi.fn().mockResolvedValue({ status: 200, data: { final_video_id: 5 } }),
    });
    await startOverlayPublishRender({ projectId: 7, onComplete, deps });

    // The synchronous 200 path fired completion and marked the store complete.
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(deps.completeExport).toHaveBeenCalledWith('export_test_1');

    // The WS complete frame ALSO arrives (documented dual transport) — still once.
    getWs().onComplete({ final_video_id: 5 });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('POST rejection: marks the store failed, tears down the WS, and fires onError once (no completion)', async () => {
    const onComplete = vi.fn();
    const onError = vi.fn();
    const err = new Error('server boom');
    err.response = { status: 500 };
    const { deps } = makeDeps({ post: vi.fn().mockRejectedValue(err) });

    const res = await startOverlayPublishRender({ projectId: 7, onComplete, onError, deps });

    expect(deps.failExport).toHaveBeenCalledWith('export_test_1', 'server boom');
    expect(deps.disconnect).toHaveBeenCalledWith('export_test_1');
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onComplete).not.toHaveBeenCalled();
    expect(res.error).toBe(true);
  });

  it('409 export_in_flight is surfaced as an error (with code), not silently dropped', async () => {
    const onError = vi.fn();
    const err = new Error('conflict');
    err.response = { status: 409, data: { detail: { code: 'export_in_flight' } } };
    const { deps } = makeDeps({ post: vi.fn().mockRejectedValue(err) });

    await startOverlayPublishRender({ projectId: 7, onError, deps });

    expect(onError).toHaveBeenCalledWith('conflict', expect.objectContaining({ code: 'export_in_flight', status: 409 }));
  });

  it('a WS error settles the render once; a later complete frame is ignored', async () => {
    const onComplete = vi.fn();
    const onError = vi.fn();
    const { deps, getWs } = makeDeps();
    await startOverlayPublishRender({ projectId: 7, onComplete, onError, deps });

    getWs().onError('ws boom', { retryable: false });
    expect(onError).toHaveBeenCalledTimes(1);

    // Completion arriving after an error is a no-op (shared one-shot).
    getWs().onComplete({ final_video_id: 5 });
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('threads WS progress through onProgress', async () => {
    const onProgress = vi.fn();
    const { deps, getWs } = makeDeps();
    await startOverlayPublishRender({ projectId: 7, onProgress, deps });

    getWs().onProgress(42, 'Rendering');
    expect(onProgress).toHaveBeenCalledWith(42, 'Rendering');
  });
});
