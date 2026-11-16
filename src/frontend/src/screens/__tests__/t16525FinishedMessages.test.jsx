import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FocusPublishActionBar } from '../../components/FocusPublishActionBar';
import { FOCUS_PUBLISH, FOCUS_FINISHED, FINISHED_TOAST, GUIDE } from '../../config/displayNames';
import { leaveFocusForLater } from '../../utils/leaveFocusForLater';
import { resumeFocusCompletion } from '../../utils/resumeFocusCompletion';
import { spotlightCompletionOutcome } from '../../utils/spotlightCompletionOutcome';
import { reportRecoveredCompletion, __resetReportedJobsForTest } from '../../utils/recoveredExportCompletion';
import { useFocusCompletionStore } from '../../stores/focusCompletionStore';
import { useGalleryStore } from '../../stores/galleryStore';
import { resolveGuide } from '../../components/instructions/resolveGuide';
import { setAnnotateOrigin, consumePendingGame, clearAnnotateOrigin } from '../../utils/pendingNavigation';
import { allowEnterFraming } from '../../utils/reelReEditable';

// T16525: the server finishes a highlight when sharpening ends (T16520). The parent is
// told it is in Highlights, without a Finish tap; when the automatic finish failed
// (`is_finished` false) the panel is today's, with its Finish button.

const handlers = () => ({ onAddSpotlight: vi.fn(), onPublish: vi.fn(), onRefocus: vi.fn(), onSaveDraft: vi.fn() });

describe('T16525 Focus ready panel', () => {
  it('finished: says it is in Highlights and offers no Finish tap', () => {
    render(<FocusPublishActionBar {...handlers()} finished />);
    expect(screen.getByRole('heading', { name: 'It’s in your Highlights' })).toBeTruthy();
    expect(screen.getByText('Nobody else can see this until you share a link.')).toBeTruthy();
    expect(screen.queryByTestId('focus-choice-publish')).toBeNull();
    expect(screen.queryByRole('button', { name: FOCUS_PUBLISH.PUBLISH_LABEL })).toBeNull();
    expect(screen.getByRole('button', { name: FOCUS_PUBLISH.ADD_SPOTLIGHT_LABEL })).toBeTruthy();
    expect(screen.getByRole('button', { name: FOCUS_PUBLISH.EDIT_FRAMING_LABEL })).toBeTruthy();
    expect(screen.getByRole('button', { name: FOCUS_FINISHED.DONE_LABEL })).toBeTruthy();
  });

  it('automatic finish failed: today\'s panel with a working Finish button', () => {
    const h = handlers();
    render(<FocusPublishActionBar {...h} finished={false} />);
    expect(screen.getByRole('heading', { name: FOCUS_PUBLISH.HEADLINE })).toBeTruthy();
    screen.getByRole('button', { name: FOCUS_PUBLISH.PUBLISH_LABEL }).click();
    expect(h.onPublish).toHaveBeenCalledTimes(1);
  });

  it('not known yet (project refresh in flight): no Finish card flashes up', () => {
    render(<FocusPublishActionBar {...handlers()} finished={null} />);
    expect(screen.queryByTestId('focus-choice-publish')).toBeNull();
    expect(screen.queryByText(FOCUS_FINISHED.HEADLINE)).toBeNull();
  });

  it('the ready guide names Done, not Finish without spotlight, once finished', () => {
    const facts = (finished) => ({ screen: 'focus', job: { status: 'ready', finished }, local: {} });
    const g = resolveGuide(facts(true));
    expect(g.id).toBe('focus.ready.finished');
    expect(g.message.title).toBe(GUIDE.focus.readyFinished);
    expect(g.message.title).not.toMatch(/Finish without spotlight/);
    expect(resolveGuide(facts(false)).id).toBe('focus.ready');
  });

  it('the waiting message says it goes to Highlights, not to go mark more plays', () => {
    expect(GUIDE.focus.progressExport).toMatch(/Highlights/);
    expect(GUIDE.focus.progressExport).not.toMatch(/mark more plays/);
  });
});

describe('T16525 Done on a finished highlight', () => {
  beforeEach(() => {
    sessionStorage.clear();
    clearAnnotateOrigin();
    useGalleryStore.setState({ justFramed: null, clipsRingTarget: null });
  });

  it('with no Annotate origin: tells the parent it is in Highlights and opens the Highlights tab', () => {
    const deps = { setEditorMode: vi.fn(), goToProjectManager: vi.fn(), toastSuccess: vi.fn() };
    leaveFocusForLater(42, { ...deps, finished: true });
    expect(deps.toastSuccess).toHaveBeenCalledWith(FINISHED_TOAST.title, expect.objectContaining({ message: FINISHED_TOAST.message }));
    expect(sessionStorage.getItem('projectManagerTab')).toBe('published');
    expect(deps.goToProjectManager).toHaveBeenCalledTimes(1);
    expect(useGalleryStore.getState().clipsRingTarget).toBeNull();
  });

  it('from Annotate: back to the play, told it is in Highlights, no "is framed, finish it any time" banner', () => {
    const deps = { setEditorMode: vi.fn(), goToProjectManager: vi.fn(), toastSuccess: vi.fn() };
    setAnnotateOrigin(42, 7, 9);
    leaveFocusForLater(42, { ...deps, finished: true });
    expect(deps.setEditorMode).toHaveBeenCalledWith('annotate');
    expect(consumePendingGame()).toMatchObject({ gameId: 7 });
    expect(useGalleryStore.getState().justFramed).toBeNull();
    expect(deps.toastSuccess).toHaveBeenCalledWith(FINISHED_TOAST.title, expect.anything());
  });
});

describe('T16525 returning parent', () => {
  beforeEach(() => {
    __resetReportedJobsForTest();
    useFocusCompletionStore.setState({ recovered: null, preview: null, resuming: false });
  });

  it('a recovered job carries whether the server finished it', () => {
    reportRecoveredCompletion({ jobId: 'j1', projectId: 42, projectName: 'R', type: 'framing', finished: true });
    expect(useFocusCompletionStore.getState().recovered).toMatchObject({ jobId: 'j1', finished: true });
  });

  it('View on a finished highlight reopens the same ready panel (now Finish-free), not the Spotlight editor', async () => {
    const project = { id: 42, name: 'R', has_final_video: true, is_finished: true };
    const deps = {
      getEditorMode: () => 'project-manager',
      getSelectedProjectId: () => null,
      selectProject: vi.fn(async () => project),
      setEditorMode: vi.fn(),
      loadProject: vi.fn(async () => {}),
      refreshProject: vi.fn(async () => project),
      resolvePreviewUrl: vi.fn(async () => 'https://cdn.example/p.mp4'),
      openPreview: vi.fn(),
      acknowledgeJob: vi.fn(async () => {}),
      recordFunnelEvent: vi.fn(),
      toastError: vi.fn(),
      EDITOR_MODES: { FRAMING: 'framing', OVERLAY: 'overlay', PROJECT_MANAGER: 'project-manager' },
      allowEnterFraming,
    };
    const result = await resumeFocusCompletion({ jobId: 'j1', projectId: 42 }, deps);
    expect(deps.setEditorMode).toHaveBeenCalledWith('framing');
    expect(deps.openPreview).toHaveBeenCalledWith(expect.objectContaining({ projectId: 42, openMode: 'framing', jobId: 'j1' }));
    expect(result).toEqual({ opened: true, navigated: true });
  });
});

describe('T16525 spotlight render', () => {
  it('a finished render lands on the highlight, no second Finish tap', () => {
    expect(spotlightCompletionOutcome({ final_video_id: 5, is_finished: true }, { isFocusOneTapPublish: false })).toBe('finished');
  });
  it('a render that did not finish keeps today\'s panel with Finish', () => {
    expect(spotlightCompletionOutcome({ final_video_id: 5, is_finished: false }, { isFocusOneTapPublish: false })).toBe('panel');
  });
  it('Focus\'s one-tap Finish fallback and a missing final video show nothing here', () => {
    expect(spotlightCompletionOutcome({ final_video_id: 5, is_finished: true }, { isFocusOneTapPublish: true })).toBe('none');
    expect(spotlightCompletionOutcome({ final_video_id: null }, { isFocusOneTapPublish: false })).toBe('none');
    expect(spotlightCompletionOutcome(null, { isFocusOneTapPublish: false })).toBe('none');
  });
});
