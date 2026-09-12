import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleOverlayExportCompletion } from './handleOverlayExportCompletion';
import { usePublishIntentStore } from '../stores/publishIntentStore';

// T9740 (fix v3) — Test 2: the REAL decision logic (not a hand-copied replica).
// The deleted appPublishAfterRender.test.js copied App.jsx's branch into the test
// file AND hard-coded final_video_id — the exact precondition that FAILS in
// production. This test drives the extracted `handleOverlayExportCompletion`
// module directly, using the REAL publishIntentStore for the stake so the
// stake-claimed-before-await fix is exercised against real store semantics.

const EDITOR_MODES = { OVERLAY: 'overlay', FRAMING: 'framing', PROJECT_MANAGER: 'project_manager' };

function makeDeps({ state = {}, publish, fetchProjects } = {}) {
  const s = {
    editorMode: 'overlay',
    selectedProjectId: 7,
    projects: [{ id: 7, name: 'Reel', aspect_ratio: '9:16', clip_count: 1, final_video_id: 6 }],
    ...state,
  };
  const publishFn = publish ?? vi.fn().mockResolvedValue(true);
  const fetchProjectsFn = fetchProjects ?? vi.fn().mockResolvedValue(s.projects);
  const goToProjectManager = vi.fn();
  const openFinishedReel = vi.fn();
  const toastSuccess = vi.fn();
  const refreshQuestProgress = vi.fn();
  const deps = {
    EDITOR_MODES,
    getPublishIntentState: () => usePublishIntentStore.getState(),
    fetchProjects: fetchProjectsFn,
    refreshQuestProgress,
    getEditorMode: () => s.editorMode,
    getSelectedProjectId: () => s.selectedProjectId,
    getProjects: () => s.projects,
    publish: publishFn,
    goToProjectManager,
    openFinishedReel,
    toastSuccess,
  };
  return { deps, publish: publishFn, fetchProjects: fetchProjectsFn, goToProjectManager, openFinishedReel, toastSuccess, refreshQuestProgress, state: s };
}

beforeEach(() => {
  usePublishIntentStore.getState().clear();
  vi.restoreAllMocks();
});

describe('handleOverlayExportCompletion (T9740 fix v3)', () => {
  it('(a) THE PRODUCTION BUG: intent staked + projects snapshot MISSING final_video_id -> publish STILL fires', async () => {
    usePublishIntentStore.getState().set(7);
    const { deps, publish, openFinishedReel, toastSuccess } = makeDeps({
      state: {
        editorMode: 'overlay',
        selectedProjectId: 7,
        // The stale-snapshot symptom the WS+HTTP fetchProjects-abort race produced:
        // final_video_id is still null when this invocation reads the snapshot.
        projects: [{ id: 7, name: 'Reel', final_video_id: null }],
      },
    });

    const result = await handleOverlayExportCompletion({ projectId: 7, mode: 'overlay' }, deps);

    // The whole point: publish is NOT gated on final_video_id anymore.
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith({ openGallery: false, projectId: 7 });
    expect(toastSuccess).toHaveBeenCalledWith('Published', { message: 'Anyone with the link can watch it.' });
    // The finished-reel preview still opens (the project object exists; its
    // final_video_id being stale-null is the preview's problem, not publish's).
    expect(openFinishedReel).toHaveBeenCalledWith(
      expect.objectContaining({ id: 7 }),
      { alreadyPublished: true },
    );
    expect(result).toMatchObject({ isOneTapPublish: true, published: true });
    // Stake consumed exactly once.
    expect(usePublishIntentStore.getState().projectId).toBeNull();
  });

  it('(b) intent staked but the user navigated away mid-render -> publish fires, navigation/preview does NOT', async () => {
    usePublishIntentStore.getState().set(7);
    const { deps, publish, goToProjectManager, openFinishedReel } = makeDeps({
      state: {
        editorMode: 'framing',       // wandered to another editor
        selectedProjectId: 99,       // ...on a different project
        projects: [{ id: 7, name: 'Reel', final_video_id: 6 }],
      },
    });

    await handleOverlayExportCompletion({ projectId: 7, mode: 'overlay' }, deps);

    expect(publish).toHaveBeenCalledWith({ openGallery: false, projectId: 7 });
    // Wandering off suppresses ONLY the screen-hijack navigation, never the publish.
    expect(goToProjectManager).not.toHaveBeenCalled();
    expect(openFinishedReel).not.toHaveBeenCalled();
  });

  it('(c) handler invoked TWICE (WS + HTTP double-fire) -> publish fires exactly once', async () => {
    usePublishIntentStore.getState().set(7);
    // fetchProjects returns a not-yet-resolved promise so BOTH invocations enter
    // their synchronous prologue before either resolves — the real WS+HTTP race.
    let resolveFetch;
    const gated = new Promise((r) => { resolveFetch = r; });
    const { deps, publish } = makeDeps({ fetchProjects: vi.fn(() => gated) });
    const completed = { projectId: 7, mode: 'overlay' };

    const p1 = handleOverlayExportCompletion(completed, deps);
    const p2 = handleOverlayExportCompletion(completed, deps);
    resolveFetch([{ id: 7, final_video_id: 6 }]);
    await Promise.all([p1, p2]);

    // The stake is claimed synchronously before the first await, so the second
    // invocation sees it cleared and never re-enters the publish block.
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('(d) NO intent staked (the "Add spotlight" case) -> publish is NEVER called and nothing navigates (AC3 lock)', async () => {
    // no stake
    const { deps, publish, goToProjectManager, openFinishedReel, toastSuccess } = makeDeps();

    const result = await handleOverlayExportCompletion({ projectId: 7, mode: 'overlay' }, deps);

    expect(publish).not.toHaveBeenCalled();
    expect(goToProjectManager).not.toHaveBeenCalled();
    expect(openFinishedReel).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(result).toMatchObject({ isOneTapPublish: false, published: null });
  });
});
