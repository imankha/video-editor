import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useEditorStore } from '../stores/editorStore';
import { useProjectsStore } from '../stores/projectsStore';
import { restoreAuthReturnProject } from './authReturnRestore';

// T16040: after the auth cross-device-recovery reload (authStore.onAuthSuccess
// saves authReturnMode/authReturnProjectId then reloads the page), Frame/Spotlight
// must come back with their clips loaded, not just the bare project record --
// selectProject() alone never populates projectDataStore's clips/working video,
// which is what FocusScreen/OverlayScreen actually render from. Same gap T15220
// fixed for the payment-return path and T15410 fixed for resume-restore.
describe('restoreAuthReturnProject', () => {
  let setEditorMode;
  let selectProject;
  let loadProject;

  beforeEach(() => {
    setEditorMode = vi.fn();
    selectProject = vi.fn().mockResolvedValue({ id: 7 });
    loadProject = vi.fn().mockResolvedValue({ mode: 'framing' });
    useEditorStore.setState({ setEditorMode });
    useProjectsStore.setState({ selectProject });
  });

  it('loads the project data, not just the record, after selecting it', async () => {
    restoreAuthReturnProject('framing', 7, { loadProject });
    expect(selectProject).toHaveBeenCalledWith(7);
    await vi.waitFor(() => expect(loadProject).toHaveBeenCalledWith({ id: 7 }, { mode: 'framing' }));
  });

  it('sets the editor mode with the project id so the URL reads /focus/p/<id>', () => {
    restoreAuthReturnProject('framing', 7, { loadProject });
    expect(setEditorMode).toHaveBeenCalledWith('framing', { projectId: 7 });
  });
});
