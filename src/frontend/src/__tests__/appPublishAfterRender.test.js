import { describe, it, expect, vi } from 'vitest';

// T8390: App.jsx is a very large root component that cannot be mounted in
// isolation (dozens of stores/providers/screens). This test harness reproduces
// the auto-publish branch of App.jsx's handleExportComplete verbatim (the
// "T8530: land the user on the finished reel" block, now with Focus's one-tap
// Publish spliced in) wired to injectable spies, asserting the WIRING CONTRACT:
// publish is called with the right args exactly when the flag matches, the
// flag is always cleared, the success toast is conditional on the publish
// result, and openFinishedReel always receives the correct alreadyPublished
// value (or none, for the pre-existing non-Focus-publish path).

/**
 * Mirrors App.jsx handleExportComplete's post-fetchProjects block, from
 * `if (finishedProject?.final_video_id) { ... }` down — the part T8390 changed.
 */
async function runFinishedReelBranch({ completed, finishedProject, publishIntent, publishFocusExit, toastSuccess, openFinishedReel }) {
  if (!finishedProject?.final_video_id) return;
  if (publishIntent.getState().projectId === completed.projectId) {
    publishIntent.getState().clear();
    const published = await publishFocusExit({ openGallery: false });
    if (published) {
      toastSuccess('Published', { message: 'Anyone with the link can watch it.' });
    }
    openFinishedReel(finishedProject, { alreadyPublished: published });
  } else {
    openFinishedReel(finishedProject);
  }
}

function makePublishIntentStore(initialProjectId) {
  let projectId = initialProjectId;
  return {
    getState: () => ({
      projectId,
      clear: () => { projectId = null; },
    }),
  };
}

describe('T8390 App.jsx handleExportComplete — Focus one-tap-publish branch', () => {
  const completed = { projectId: 7, mode: 'overlay' };
  const finishedProject = { id: 7, final_video_id: 999 };

  it('flag matches: publishes, clears the flag, toasts on success, opens already-published', async () => {
    const publishIntent = makePublishIntentStore(7);
    const publishFocusExit = vi.fn().mockResolvedValue(true);
    const toastSuccess = vi.fn();
    const openFinishedReel = vi.fn();

    await runFinishedReelBranch({ completed, finishedProject, publishIntent, publishFocusExit, toastSuccess, openFinishedReel });

    expect(publishFocusExit).toHaveBeenCalledWith({ openGallery: false });
    expect(publishIntent.getState().projectId).toBeNull();
    expect(toastSuccess).toHaveBeenCalledWith('Published', { message: 'Anyone with the link can watch it.' });
    expect(openFinishedReel).toHaveBeenCalledWith(finishedProject, { alreadyPublished: true });
  });

  it('flag matches but publish fails: no toast, opens NOT-already-published (so the draft preview offers Retry), flag still cleared', async () => {
    const publishIntent = makePublishIntentStore(7);
    const publishFocusExit = vi.fn().mockResolvedValue(false);
    const toastSuccess = vi.fn();
    const openFinishedReel = vi.fn();

    await runFinishedReelBranch({ completed, finishedProject, publishIntent, publishFocusExit, toastSuccess, openFinishedReel });

    expect(toastSuccess).not.toHaveBeenCalled();
    expect(publishIntent.getState().projectId).toBeNull();
    expect(openFinishedReel).toHaveBeenCalledWith(finishedProject, { alreadyPublished: false });
  });

  it('flag does not match this project: publish never called, opens the finished reel WITHOUT alreadyPublished (unchanged T8530 path)', async () => {
    const publishIntent = makePublishIntentStore(null);
    const publishFocusExit = vi.fn();
    const toastSuccess = vi.fn();
    const openFinishedReel = vi.fn();

    await runFinishedReelBranch({ completed, finishedProject, publishIntent, publishFocusExit, toastSuccess, openFinishedReel });

    expect(publishFocusExit).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(openFinishedReel).toHaveBeenCalledWith(finishedProject);
    expect(openFinishedReel).toHaveBeenCalledTimes(1);
    expect(openFinishedReel.mock.calls[0].length).toBe(1);
  });

  it('flag stakes a DIFFERENT project: publish never called for this completion', async () => {
    const publishIntent = makePublishIntentStore(123);
    const publishFocusExit = vi.fn();
    const openFinishedReel = vi.fn();

    await runFinishedReelBranch({ completed, finishedProject, publishIntent, publishFocusExit, toastSuccess: vi.fn(), openFinishedReel });

    expect(publishFocusExit).not.toHaveBeenCalled();
    // A stale flag for a different project is left untouched (not this
    // completion's job to clear another project's stake).
    expect(publishIntent.getState().projectId).toBe(123);
    expect(openFinishedReel).toHaveBeenCalledWith(finishedProject);
  });
});
