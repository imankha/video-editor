/**
 * handleOverlayExportCompletion (T9740 fix v3) — the decision logic that used to
 * live inline in App.jsx's `handleExportComplete`, extracted so it can be tested
 * against the REAL implementation instead of a hand-copied replica. (The deleted
 * `appPublishAfterRender.test.js` copied the old branch into the test file AND
 * hard-coded `final_video_id`, i.e. the exact precondition that FAILS in
 * production — a landmine, not coverage. Extraction is what kills that drift.)
 *
 * ── The bug three prior rounds chased ──────────────────────────────────────────
 * A "Publish without spotlight" overlay render has NO enabled highlight keyframes,
 * so the backend takes the synchronous-200 path (overlay.py) that sends the WS
 * `status:"complete"` frame AND returns HTTP 200 — both transports deliver the
 * SAME completion, so this handler fires TWICE. Each invocation calls
 * `fetchProjects({force:true})`, which ABORTS any in-flight fetch; the aborted
 * (first-resolving) invocation reads a STALE projects snapshot where
 * `final_video_id` is still null, and the OLD code gated the publish call on
 * `finishedProject?.final_video_id` — so it navigated home and then silently
 * bailed, never publishing. Zero console errors, "Ready to Publish" card left
 * behind. Exactly the staging observation, three rounds running.
 *
 * ── The fix (two structural moves) ─────────────────────────────────────────────
 * 1. Claim the publish-intent stake SYNCHRONOUSLY, before the first `await`. The
 *    stake itself is the idempotency token, so ANY future double-fire from ANY
 *    transport is a no-op BY CONSTRUCTION, not by luck.
 * 2. Split the NAVIGATION decision (only hijack the user's screen if they are
 *    still in the Overlay editor for this project) from the PUBLISH decision
 *    (gated ONLY on the one-tap stake). Wandering off mid-render suppresses the
 *    screen-hijack, never the publish. `final_video_id` is no longer a
 *    precondition for publishing — the server (`downloads.py`) already guards the
 *    "no final video" case with a loud 404 off the real `final_videos` row, not
 *    the stale `projects.final_video_id` field.
 *
 * NO SILENT BAILS: every path that declines to publish or navigate logs a named,
 * greppable reason before falling through.
 *
 * All collaborators are INJECTED (store getters + a publish fn) so the test drives
 * real store instances / a real publish, never a mock that assumes the old shape.
 *
 * @param {{projectId:number, mode:string}} completed - which export finished
 * @param {Object} deps
 * @param {Object} deps.EDITOR_MODES
 * @param {() => {projectId:number|null, clear:Function}} deps.getPublishIntentState
 * @param {(opts:{force:boolean}) => Promise<any>} deps.fetchProjects
 * @param {() => void} deps.refreshQuestProgress
 * @param {() => string} deps.getEditorMode - CURRENT editor mode (fresh read)
 * @param {() => number|null} deps.getSelectedProjectId - CURRENT selection (fresh read)
 * @param {() => Array} deps.getProjects - CURRENT projects snapshot (post-fetch)
 * @param {(opts:{openGallery:boolean, projectId:number}) => Promise<boolean>} deps.publish
 * @param {() => void} deps.goToProjectManager
 * @param {(project:Object, opts?:Object) => void} deps.openFinishedReel
 * @param {(title:string, opts:Object) => void} deps.toastSuccess
 * @returns {Promise<{isOneTapPublish:boolean, published:boolean|null, navigated:boolean}>}
 */
export async function handleOverlayExportCompletion(completed, {
  EDITOR_MODES,
  getPublishIntentState,
  fetchProjects,
  refreshQuestProgress,
  getEditorMode,
  getSelectedProjectId,
  getProjects,
  publish,
  goToProjectManager,
  openFinishedReel,
  toastSuccess,
}) {
  // 1. Claim the one-tap publish stake SYNCHRONOUSLY, before ANY await. The stake
  //    becomes the idempotency token: whichever transport (WS or HTTP-200)
  //    delivers this completion first clears it, so a second delivery can never
  //    re-enter the publish block. Keep the boolean in a local — the stake is
  //    cleared now, so it can't be re-checked later.
  const isOneTapPublish =
    completed?.mode === EDITOR_MODES.OVERLAY &&
    getPublishIntentState().projectId === completed?.projectId;
  if (isOneTapPublish) getPublishIntentState().clear();

  await fetchProjects({ force: true });
  // Downloads count is auto-refreshed by DownloadsPanel via galleryStore.
  // T540: refresh quest progress after any export completes.
  refreshQuestProgress();

  // Read mode/project FRESH from stores: the export WebSocket manager holds this
  // callback from export start, so closure values can be stale.
  const currentMode = getEditorMode();
  const currentProjectId = getSelectedProjectId();

  // T9740: named assertion (log only, no behavior change). A one-tap publish
  // stakes intent for a project and MUST complete via the OVERLAY render. A
  // NON-overlay (framing) completion arriving while that project's intent is
  // still staked means the wrong export button fired (the PR #417 class of bug).
  if (
    completed?.mode !== EDITOR_MODES.OVERLAY &&
    getPublishIntentState().projectId === completed?.projectId
  ) {
    console.error(
      '[App] T9740: non-overlay export completed while a one-tap publish intent was staked for project',
      completed?.projectId,
      `(mode="${completed?.mode}") — the wrong export button fired.`,
    );
  }

  if (!isOneTapPublish) {
    // Not a one-tap publish. Either a NON-overlay completion, or a PLAIN overlay
    // export (no intent staked) whose completion experience OverlayScreen owns
    // (its in-screen preview + publish-exit action bar, T9110). App deliberately
    // does nothing here — this is by design, not a dropped publish.
    return { isOneTapPublish: false, published: null, navigated: false };
  }

  // 2a. PUBLISH decision — gated ONLY on the stake claimed above, never on
  //     navigation state or a stale `final_video_id` snapshot read. Safe because
  //     publish POSTs to an explicit project id and the server guards the
  //     "no final video" case with its own 404.
  const published = await publish({ openGallery: false, projectId: completed.projectId });
  if (published) {
    toastSuccess('Published', { message: 'Anyone with the link can watch it.' });
  } else {
    console.error(
      '[App] T9740: one-tap publish POST failed for project',
      completed.projectId,
      '— staying put; the Ready-to-Publish card offers a manual retry.',
    );
  }

  // 2b. NAVIGATION / PREVIEW decision — SEPARATE from the publish above. Only
  //     hijack the user's screen (land them on the finished reel) if they are
  //     STILL in the Overlay editor for THIS project. A user who wandered to
  //     another screen mid-render keeps their place; the publish already fired.
  let navigated = false;
  if (currentMode === EDITOR_MODES.OVERLAY && completed.projectId === currentProjectId) {
    // Atomic transition: clear selection + reset video + switch mode together so
    // an in-flight project refresh can't resurrect the selection afterward.
    goToProjectManager();
    // Re-read the project AFTER the forced fetchProjects above so the preview
    // opens with the freshest snapshot. `finishedProject` is used ONLY as the
    // preview payload (name/aspect_ratio/clip_count/final_video_id per
    // finishedReelNav.js) — NOT as a publish precondition.
    const finishedProject = getProjects()?.find((p) => p.id === completed.projectId);
    if (finishedProject) {
      openFinishedReel(finishedProject, { alreadyPublished: published });
      navigated = true;
    } else {
      console.error(
        '[App] T9740: published project', completed.projectId,
        'missing from projects snapshot — skipping finished-reel preview (publish already fired).',
      );
    }
  }

  return { isOneTapPublish: true, published, navigated };
}
