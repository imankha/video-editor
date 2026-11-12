import { useEditorStore } from '../stores/editorStore';
import { useProjectsStore } from '../stores/projectsStore';

/**
 * Restore navigation state after the auth cross-device-recovery reload
 * (authStore.onAuthSuccess saves authReturnMode/authReturnProjectId to
 * sessionStorage then calls window.location.reload()).
 *
 * @param {string} mode - the EDITOR_MODES value to restore
 * @param {number} projectId - the project to reselect
 * @param {Function} loadProject - App.jsx's useProjectLoader().loadProject, passed in
 *   because this file is a plain module, not a component. T16040: selectProject()
 *   alone only fetches the project record -- it never populates projectDataStore's
 *   clips/working video, which is what FocusScreen/OverlayScreen actually render
 *   from (same gap T15220 fixed for payment-return and T15410 fixed for
 *   resume-restore). Without it, a FRAMING/OVERLAY return hung on "Loading..."
 *   forever.
 */
export function restoreAuthReturnProject(mode, projectId, { loadProject } = {}) {
  useEditorStore.getState().setEditorMode(mode, { projectId });
  return useProjectsStore.getState().selectProject(projectId).then(async (project) => {
    if (!project) return;
    await loadProject(project, { mode });
  }).catch((err) => console.error('[authReturnRestore] Project load failed:', err));
}
