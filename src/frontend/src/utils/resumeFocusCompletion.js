/**
 * resumeFocusCompletion (T9285) — carries a Focus completion discovered by the
 * recovery path into the SAME preview-first screen the live path shows
 * (design §2.3c). All collaborators are injected (no React/store imports), so
 * tests drive the real module, mirroring handleOverlayExportCompletion.js's
 * testable-injection pattern.
 *
 * Ordering is load-bearing and locked by a test: `selectProject` resolves
 * BEFORE `setEditorMode`, so the `App.jsx:551-557` "editor mode with no
 * project" redirect's precondition is satisfied before the mode ever changes.
 * `loadProject` receives `{ mode: 'framing' }` EXPLICITLY — `useProjectLoader`
 * defaults to 'overlay' whenever `working_video_id` is set with no final video,
 * which is exactly the post-framing-render state (design §5 risk).
 *
 * The "already standing in Focus for this project" branch skips
 * `selectProject`/`loadProject` (both reset four stores) and opens the preview
 * in place — a recovered completion must never reset a live editor under the
 * user.
 *
 * §6a: `acknowledgeJob` fires only AFTER `openPreview` succeeds, converting the
 * View gesture into the write that finally marks the job seen (deferred from
 * useExportRecovery's old unconditional mount-time acknowledge for framing
 * jobs specifically).
 *
 * @param {{jobId:string, projectId:number}} recovered
 * @param {Object} deps
 * @param {() => string} deps.getEditorMode
 * @param {() => number|null} deps.getSelectedProjectId
 * @param {(projectId:number) => Promise<Object|null>} deps.selectProject
 * @param {(mode:string) => void} deps.setEditorMode
 * @param {(project:Object, opts:Object) => Promise<any>} deps.loadProject
 * @param {(projectId:number) => Promise<string|null>} deps.resolvePreviewUrl
 * @param {(payload:{projectId:number, previewUrl:string, openMode:string}) => void} deps.openPreview
 * @param {(jobId:string) => Promise<void>} deps.acknowledgeJob
 * @param {(id:string) => void} deps.recordAchievement
 * @param {(title:string, opts:Object) => void} deps.toastError
 * @param {Object} deps.EDITOR_MODES
 * @returns {Promise<{opened:boolean, navigated:boolean}>}
 */
export async function resumeFocusCompletion({ jobId, projectId }, {
  getEditorMode,
  getSelectedProjectId,
  selectProject,
  setEditorMode,
  loadProject,
  resolvePreviewUrl,
  openPreview,
  acknowledgeJob,
  recordAchievement,
  toastError,
  EDITOR_MODES,
}) {
  const previewUrl = await resolvePreviewUrl(projectId);
  if (!previewUrl) {
    console.error('[ResumeFocus] no working-video preview URL for project', projectId);
    toastError("Couldn't open the preview", { message: 'Open the clip from Clips to finish it.' });
    return { opened: false, navigated: false };
  }

  // Already standing in Focus for this project (the recovered export finished
  // while the user had navigated back in): open in place. selectProject/
  // loadProject would reset projectData/focus/overlay/video stores under a
  // live editor, which is not a cosmetic cost.
  if (getEditorMode() === EDITOR_MODES.FRAMING && getSelectedProjectId() === projectId) {
    openPreview({ projectId, previewUrl, openMode: EDITOR_MODES.FRAMING });
    recordAchievement('overlay_offered');
    await acknowledgeJob(jobId);
    return { opened: true, navigated: false };
  }

  const project = await selectProject(projectId);
  if (!project) {
    console.error('[ResumeFocus] failed to select project', projectId);
    toastError("Couldn't open this draft", { message: 'The connection dropped. Check your network and try again.' });
    return { opened: false, navigated: false };
  }

  setEditorMode(EDITOR_MODES.FRAMING);
  await loadProject(project, { mode: EDITOR_MODES.FRAMING });
  openPreview({ projectId, previewUrl, openMode: EDITOR_MODES.FRAMING });
  recordAchievement('overlay_offered');
  await acknowledgeJob(jobId);
  return { opened: true, navigated: true };
}
