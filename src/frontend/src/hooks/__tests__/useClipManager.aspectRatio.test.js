import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('../../config', () => ({ API_BASE: '', API_BASE_URL: '' }));
vi.mock('../../utils/apiFetch', () => ({ default: vi.fn() }));

import { useClipManager } from '../useClipManager';
import { useProjectsStore } from '../../stores/projectsStore';
import { useProjectDataStore } from '../../stores/projectDataStore';

/**
 * T10980: the Focus aspect-ratio selector showed "Landscape" for a portrait
 * project because the ratio it read was a second in-memory copy that only the
 * Drafts open path wrote. There is now exactly one source: the selected
 * project's aspect_ratio. Entering Focus by any path (Annotate save, auth
 * return, Drafts) selects the project, so the selector can never lag it.
 */
describe('useClipManager.globalAspectRatio (T10980)', () => {
  beforeEach(() => {
    useProjectDataStore.getState().reset();
    useProjectsStore.setState({ selectedProjectId: null, selectedProject: null });
  });

  it('reads the selected project ratio, not a store copy left by a previous project', () => {
    useProjectsStore.setState({ selectedProjectId: 1, selectedProject: { id: 1, aspect_ratio: '16:9' } });
    const { result } = renderHook(() => useClipManager());
    expect(result.current.globalAspectRatio).toBe('16:9');

    // A different project selected through any entry path (no loadProject call).
    act(() => {
      useProjectsStore.setState({ selectedProjectId: 2, selectedProject: { id: 2, aspect_ratio: '9:16' } });
    });
    expect(result.current.globalAspectRatio).toBe('9:16');
  });

  it('follows a project refresh after the ratio gesture lands', () => {
    useProjectsStore.setState({ selectedProjectId: 1, selectedProject: { id: 1, aspect_ratio: '9:16' } });
    const { result } = renderHook(() => useClipManager());
    act(() => {
      useProjectsStore.setState({ selectedProject: { id: 1, aspect_ratio: '16:9' } });
    });
    expect(result.current.globalAspectRatio).toBe('16:9');
    expect(result.current.getExportData().globalAspectRatio).toBe('16:9');
  });

  it('projectDataStore no longer carries an aspectRatio field', () => {
    expect('aspectRatio' in useProjectDataStore.getState()).toBe(false);
    expect('setAspectRatio' in useProjectDataStore.getState()).toBe(false);
  });

  it('the bug-report editor context reports the project ratio (Reviewer catch)', async () => {
    const { getEditorContext } = await import('../../utils/editorContext');
    useProjectsStore.setState({ selectedProjectId: 7, selectedProject: { id: 7, aspect_ratio: '16:9' } });
    expect(getEditorContext().project.aspectRatio).toBe('16:9');
  });
});
