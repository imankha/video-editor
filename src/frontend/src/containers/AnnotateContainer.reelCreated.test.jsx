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

  it('fires one success toast naming the clip and its new home (Clips)', () => {
    announceReelCreated(42, { onOpenReelInFocus, fetchProjects, clipName: 'Brilliant Interception' });
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].type).toBe('success');
    expect(toasts[0].title).toBe('Brilliant Interception is now in Clips');
    expect(toasts[0].duration).toBe(6000);
  });

  it('falls back to a generic clip name when none is supplied', () => {
    announceReelCreated(42, { onOpenReelInFocus, fetchProjects });
    const toasts = useToastStore.getState().toasts;
    expect(toasts[0].title).toBe('Your clip is now in Clips');
  });

  it('the toast action opens Focus for the new project via the select+navigate gesture', () => {
    announceReelCreated(42, { onOpenReelInFocus, fetchProjects });
    const { action } = useToastStore.getState().toasts[0];
    expect(action.label).toBe('Open AI Focus');
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

  // T9660 (preservation guard): Andrew praised being able to keep marking plays
  // without interruption, so repeated Save must NEVER pull the user into another
  // editor on its own. announceReelCreated is the ONLY navigation seam in the
  // Save path (handleFullscreenCreateClip otherwise stays open per T9330, and its
  // selectProject is memory-only — Annotate is inert to selection, so the playhead
  // does not move). This asserts that seam only OFFERS Focus (via the toast action
  // the user must click), and never auto-opens it — the regression a forced
  // first-clip wizard would introduce.
  it('repeated saves never auto-open Focus; the playhead stays in Annotate until the user clicks Open Focus (T9660)', () => {
    // Three back-to-back project-created saves (marking play after play).
    announceReelCreated(42, { onOpenReelInFocus, fetchProjects });
    announceReelCreated(43, { onOpenReelInFocus, fetchProjects });
    announceReelCreated(44, { onOpenReelInFocus, fetchProjects });

    // No save navigated into the Focus editor on its own.
    expect(onOpenReelInFocus).not.toHaveBeenCalled();

    // The only route to Focus is the explicit toast-action click (a user gesture).
    const { action } = useToastStore.getState().toasts[0];
    action.onClick();
    expect(onOpenReelInFocus).toHaveBeenCalledTimes(1);
  });
});
