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
 * user. It still calls `refreshProject` (review fix) before resolving the
 * preview URL: the live completion path does the same
 * (`FocusScreen.jsx`'s `handleProceedToOverlayInternal`, `await refreshProject()`
 * before `resolveWorkingVideoPreviewUrl`) because project-derived UI
 * (`hasOverlayVideo`, header out-of-sync badges, etc.) needs the just-finished
 * render's `working_video_id`, not whatever was cached before this completion.
 *
 * Deliberately duplicates (not extracts) the minimal
 * selectProject→setEditorMode→loadProject sequence
 * `ProjectsScreen.jsx:257-302`'s `handleSelectProjectWithMode` also runs — the
 * abstract-on-3rd-duplication rule applies at 2 call sites, and this resume
 * skips ProjectsScreen's breadcrumb/profiling/`onStateReset` bits on purpose
 * (design §4). Named here so drift between the two stays visible.
 *
 * §6a: `acknowledgeJob` fires only AFTER `openPreview` succeeds, converting the
 * View gesture into the write that finally marks the job seen (deferred from
 * useExportRecovery's old unconditional mount-time acknowledge for framing
 * jobs specifically).
 *
 * The whole sequence is wrapped in try/catch: `loadProject` (and, in
 * principle, any of these injected calls) can reject, and an unhandled
 * rejection here would strand the UI mid-transition (stores already reset,
 * editorMode already flipped to FRAMING, no toast, no card) — see review
 * finding. A caught failure reports loudly and returns `{opened:false}`; the
 * job is NOT acknowledged on that path, so it correctly re-prompts next load.
 *
 * @param {{jobId:string, projectId:number}} recovered
 * @param {Object} deps
 * @param {() => string} deps.getEditorMode
 * @param {() => number|null} deps.getSelectedProjectId
 * @param {(projectId:number) => Promise<Object|null>} deps.selectProject
 * @param {(mode:string) => void} deps.setEditorMode
 * @param {(project:Object, opts:Object) => Promise<any>} deps.loadProject
 * @param {() => Promise<Object|null>} deps.refreshProject
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
  refreshProject,
  resolvePreviewUrl,
  openPreview,
  acknowledgeJob,
  recordAchievement,
  toastError,
  EDITOR_MODES,
}) {
  try {
    const alreadyInFocus = getEditorMode() === EDITOR_MODES.FRAMING && getSelectedProjectId() === projectId;

    // Already standing in Focus for this project (the recovered export
    // finished while the user had navigated back in): skip selectProject/
    // loadProject (both reset four stores under a live editor, not a cosmetic
    // cost) but still refresh the project so its derived fields reflect the
    // render that just completed.
    if (alreadyInFocus) {
      await refreshProject();
    }

    const previewUrl = await resolvePreviewUrl(projectId);
    if (!previewUrl) {
      console.error('[ResumeFocus] no working-video preview URL for project', projectId);
      toastError("Couldn't open the preview", { message: 'Open the clip from Clips to finish it.' });
      return { opened: false, navigated: false };
    }

    if (alreadyInFocus) {
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
  } catch (err) {
    console.error('[ResumeFocus] failed to resume Focus completion for project', projectId, err);
    toastError("Couldn't open the preview", { message: 'Open the clip from Clips to finish it.' });
    return { opened: false, navigated: false };
  }
}
