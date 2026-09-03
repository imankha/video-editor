import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { announceReelCreated } from './AnnotateContainer';
import { useProjectsStore } from '../stores/projectsStore';
import { useToastStore } from '../components/shared/Toast';

// T8480: every `result.project_created` response must select the new project
// (which is what enables the Focus tab) and fire ONE toast with the exact
// user-decided copy, whose action opens Focus.

const originalSelectProject = useProjectsStore.getState().selectProject;

describe('announceReelCreated (T8480)', () => {
  let selectProject;
  let fetchProjects;
  let onOpenReelInFocus;

  beforeEach(() => {
    selectProject = vi.fn();
    fetchProjects = vi.fn();
    onOpenReelInFocus = vi.fn();
    useProjectsStore.setState({ selectProject });
    useToastStore.setState({ toasts: [] });
  });

  afterEach(() => {
    useProjectsStore.setState({ selectProject: originalSelectProject });
    useToastStore.setState({ toasts: [] });
  });

  it('selects the freshly created project so the Focus tab unlocks with zero extra gestures', () => {
    announceReelCreated(42, { onOpenReelInFocus, fetchProjects });
    expect(selectProject).toHaveBeenCalledTimes(1);
    expect(selectProject).toHaveBeenCalledWith(42);
  });

  it('fires one success toast with the exact user-decided copy', () => {
    announceReelCreated(42, { onOpenReelInFocus, fetchProjects });
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].type).toBe('success');
    expect(toasts[0].title).toBe('Reel started, click Focus to complete');
    expect(toasts[0].duration).toBe(6000);
  });

  it('the toast action opens Focus for the new project via the select+navigate gesture', () => {
    announceReelCreated(42, { onOpenReelInFocus, fetchProjects });
    const { action } = useToastStore.getState().toasts[0];
    expect(action.label).toBe('Open Focus');
    action.onClick();
    expect(onOpenReelInFocus).toHaveBeenCalledWith(42);
  });

  it('rapid consecutive creations dedupe to one toast (dedupKey)', () => {
    announceReelCreated(42, { onOpenReelInFocus, fetchProjects });
    announceReelCreated(43, { onOpenReelInFocus, fetchProjects });
    expect(useToastStore.getState().toasts).toHaveLength(1);
  });

  it('force-refreshes the projects list so Home/drawer counts include the new draft', () => {
    announceReelCreated(42, { onOpenReelInFocus, fetchProjects });
    expect(fetchProjects).toHaveBeenCalledWith({ force: true });
  });
});
