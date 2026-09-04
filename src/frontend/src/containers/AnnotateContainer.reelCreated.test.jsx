import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { announceReelCreated } from './AnnotateContainer';
import { useProjectsStore } from '../stores/projectsStore';
import { useToastStore } from '../components/shared/Toast';

// T8480: every `result.project_created` response must select the new project
// (which is what enables the Focus tab) and fire ONE toast whose action opens
// Focus. T8760 item 2: the copy now names the clip and confirms its new home,
// the "In Progress Clips" tab.

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

  it('fires one success toast naming the clip and its new home (In Progress Clips)', () => {
    announceReelCreated(42, { onOpenReelInFocus, fetchProjects, clipName: 'Brilliant Interception' });
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].type).toBe('success');
    expect(toasts[0].title).toBe('Brilliant Interception is now in In Progress Clips');
    expect(toasts[0].duration).toBe(6000);
  });

  it('falls back to a generic clip name when none is supplied', () => {
    announceReelCreated(42, { onOpenReelInFocus, fetchProjects });
    const toasts = useToastStore.getState().toasts;
    expect(toasts[0].title).toBe('Your clip is now in In Progress Clips');
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
