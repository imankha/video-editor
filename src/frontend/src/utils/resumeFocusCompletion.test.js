import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resumeFocusCompletion } from './resumeFocusCompletion';

// T9285 — resumeFocusCompletion carries a recovered Focus completion into the
// SAME preview-first screen the live path shows (design §2.3c). All
// collaborators are injected, mirroring handleOverlayExportCompletion.js's
// testable-injection pattern, so this drives the REAL module.

const EDITOR_MODES = { FRAMING: 'framing', OVERLAY: 'overlay', PROJECT_MANAGER: 'project-manager' };

function makeDeps(overrides = {}) {
  const calls = [];
  const project = { id: 42, name: 'My Reel' };
  const deps = {
    getEditorMode: vi.fn(() => 'project-manager'),
    getSelectedProjectId: vi.fn(() => null),
    selectProject: vi.fn(async () => {
      calls.push('selectProject');
      return project;
    }),
    setEditorMode: vi.fn(() => { calls.push('setEditorMode'); }),
    loadProject: vi.fn(async () => { calls.push('loadProject'); return { mode: 'framing' }; }),
    refreshProject: vi.fn(async () => { calls.push('refreshProject'); return project; }),
    resolvePreviewUrl: vi.fn(async () => 'https://cdn.example/preview.mp4'),
    openPreview: vi.fn(() => { calls.push('openPreview'); }),
    acknowledgeJob: vi.fn(async () => { calls.push('acknowledgeJob'); }),
    recordAchievement: vi.fn(),
    toastError: vi.fn(),
    EDITOR_MODES,
    ...overrides,
  };
  return { deps, calls, project };
}

describe('resumeFocusCompletion (T9285)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('ordering: selectProject resolves BEFORE setEditorMode, and loadProject receives explicit mode:framing', async () => {
    const { deps, calls } = makeDeps();

    const result = await resumeFocusCompletion({ jobId: 'job-1', projectId: 42 }, deps);

    expect(calls).toEqual(['selectProject', 'setEditorMode', 'loadProject', 'openPreview', 'acknowledgeJob']);
    expect(deps.loadProject).toHaveBeenCalledWith(
      expect.objectContaining({ id: 42 }),
      expect.objectContaining({ mode: 'framing' }),
    );
    expect(deps.setEditorMode).toHaveBeenCalledWith('framing');
    expect(deps.openPreview).toHaveBeenCalledWith({
      projectId: 42, previewUrl: 'https://cdn.example/preview.mp4', openMode: 'framing',
    });
    expect(deps.recordAchievement).toHaveBeenCalledWith('overlay_offered');
    expect(deps.acknowledgeJob).toHaveBeenCalledWith('job-1');
    expect(result).toEqual({ opened: true, navigated: true });
  });

  it('null preview URL: no openPreview, one console.error, one toast, no navigation, no acknowledge', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { deps } = makeDeps({ resolvePreviewUrl: vi.fn(async () => null) });

    const result = await resumeFocusCompletion({ jobId: 'job-2', projectId: 42 }, deps);

    expect(deps.openPreview).not.toHaveBeenCalled();
    expect(deps.selectProject).not.toHaveBeenCalled();
    expect(deps.setEditorMode).not.toHaveBeenCalled();
    expect(deps.loadProject).not.toHaveBeenCalled();
    expect(deps.acknowledgeJob).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(deps.toastError).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ opened: false, navigated: false });
  });

  it('already standing in Focus for this project: refreshes the project, skips selectProject/loadProject entirely, opens in place', async () => {
    const { deps, calls } = makeDeps({
      getEditorMode: vi.fn(() => 'framing'),
      getSelectedProjectId: vi.fn(() => 42),
    });

    const result = await resumeFocusCompletion({ jobId: 'job-3', projectId: 42 }, deps);

    expect(deps.selectProject).not.toHaveBeenCalled();
    expect(deps.loadProject).not.toHaveBeenCalled();
    expect(deps.setEditorMode).not.toHaveBeenCalled();
    // refreshProject BEFORE resolving the preview URL, mirroring the live
    // completion path's own refreshProject-then-resolve ordering.
    expect(calls).toEqual(['refreshProject', 'openPreview', 'acknowledgeJob']);
    expect(deps.openPreview).toHaveBeenCalledWith({
      projectId: 42, previewUrl: 'https://cdn.example/preview.mp4', openMode: 'framing',
    });
    expect(deps.recordAchievement).toHaveBeenCalledWith('overlay_offered');
    expect(result).toEqual({ opened: true, navigated: false });
  });

  it('the select+load branch does NOT call refreshProject (selectProject/loadProject already fetch fresh data)', async () => {
    const { deps } = makeDeps();

    await resumeFocusCompletion({ jobId: 'job-3b', projectId: 42 }, deps);

    expect(deps.refreshProject).not.toHaveBeenCalled();
  });

  it('already-in-Focus branch requires BOTH editorMode AND selectedProjectId to match — a different project still navigates', async () => {
    const { deps, calls } = makeDeps({
      getEditorMode: vi.fn(() => 'framing'),
      getSelectedProjectId: vi.fn(() => 99), // different project
    });

    await resumeFocusCompletion({ jobId: 'job-4', projectId: 42 }, deps);

    expect(deps.selectProject).toHaveBeenCalledWith(42);
    expect(deps.loadProject).toHaveBeenCalled();
    expect(calls).toEqual(['selectProject', 'setEditorMode', 'loadProject', 'openPreview', 'acknowledgeJob']);
  });

  it('acknowledgeJob fires AFTER openPreview succeeds (T9285 §6a deferred-acknowledge ordering)', async () => {
    const { deps, calls } = makeDeps();

    await resumeFocusCompletion({ jobId: 'job-5', projectId: 42 }, deps);

    const openIdx = calls.indexOf('openPreview');
    const ackIdx = calls.indexOf('acknowledgeJob');
    expect(openIdx).toBeGreaterThanOrEqual(0);
    expect(ackIdx).toBeGreaterThan(openIdx);
  });

  it('selectProject failing (returns falsy) logs loudly, toasts, and never opens/acknowledges', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { deps } = makeDeps({ selectProject: vi.fn(async () => null) });

    const result = await resumeFocusCompletion({ jobId: 'job-6', projectId: 42 }, deps);

    expect(deps.setEditorMode).not.toHaveBeenCalled();
    expect(deps.loadProject).not.toHaveBeenCalled();
    expect(deps.openPreview).not.toHaveBeenCalled();
    expect(deps.acknowledgeJob).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
    expect(deps.toastError).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ opened: false, navigated: false });
  });

  // T9285 review fix: loadProject (useProjectLoader.js) rethrows on failure —
  // an uncaught rejection here would strand the UI mid-transition (stores
  // already reset, editorMode already flipped to FRAMING, no toast shown).
  it('loadProject throwing is caught: logs loudly, toasts, never opens/acknowledges, and does not propagate', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { deps } = makeDeps({ loadProject: vi.fn(async () => { throw new Error('boom'); }) });

    await expect(resumeFocusCompletion({ jobId: 'job-7', projectId: 42 }, deps)).resolves.toEqual({
      opened: false, navigated: false,
    });

    expect(deps.openPreview).not.toHaveBeenCalled();
    expect(deps.acknowledgeJob).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
    expect(deps.toastError).toHaveBeenCalledTimes(1);
  });

  it('selectProject throwing (network error, not just a falsy return) is caught the same way', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { deps } = makeDeps({ selectProject: vi.fn(async () => { throw new Error('network down'); }) });

    await expect(resumeFocusCompletion({ jobId: 'job-8', projectId: 42 }, deps)).resolves.toEqual({
      opened: false, navigated: false,
    });

    expect(deps.setEditorMode).not.toHaveBeenCalled();
    expect(deps.openPreview).not.toHaveBeenCalled();
    expect(deps.acknowledgeJob).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
    expect(deps.toastError).toHaveBeenCalledTimes(1);
  });

  it('refreshProject throwing in the already-in-Focus branch is caught, never opens/acknowledges', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { deps } = makeDeps({
      getEditorMode: vi.fn(() => 'framing'),
      getSelectedProjectId: vi.fn(() => 42),
      refreshProject: vi.fn(async () => { throw new Error('refresh failed'); }),
    });

    await expect(resumeFocusCompletion({ jobId: 'job-9', projectId: 42 }, deps)).resolves.toEqual({
      opened: false, navigated: false,
    });

    expect(deps.openPreview).not.toHaveBeenCalled();
    expect(deps.acknowledgeJob).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
    expect(deps.toastError).toHaveBeenCalledTimes(1);
  });

  it('openPreview throwing is caught (defense-in-depth: no unhandled rejection reaches the caller)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { deps } = makeDeps({ openPreview: vi.fn(() => { throw new Error('store write failed'); }) });

    await expect(resumeFocusCompletion({ jobId: 'job-10', projectId: 42 }, deps)).resolves.toEqual({
      opened: false, navigated: false,
    });

    expect(deps.acknowledgeJob).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
    expect(deps.toastError).toHaveBeenCalledTimes(1);
  });
});
