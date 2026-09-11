import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { useState, useCallback } from 'react';
import { OverlayPublishActionBar } from '../../components/OverlayPublishActionBar';
import { OVERLAY_PUBLISH, OVERLAY_REAPPLY_FOCUS_TOAST, FOCUS_PUBLISH_LATER_TOAST } from '../../config/displayNames';
import { usePublishIntentStore } from '../../stores/publishIntentStore';
import { EDITOR_MODES } from '../../stores/editorStore';

// T9110: OverlayScreen is a very large screen that cannot be mounted in isolation
// (dozens of stores/hooks/contexts). This harness reproduces the post-export
// completion preview + publish-exit action bar exactly as OverlayScreen renders
// it, plus the handleExportComplete gate and the four gesture handlers verbatim,
// wired to injectable spies. It asserts the WIRING CONTRACT: which publish/toast/
// navigation each choice fires, and that a Focus one-tap Publish (publish intent
// staked) suppresses this preview (App.jsx owns that path). The action bar render
// (labels/captions) is real (OverlayPublishActionBar), not reproduced.
//
// Publish-intent gating goes through the REAL usePublishIntentStore (not a spy):
// the "don't show my preview when App is auto-publishing" branch is conditional
// on the store's actual current value, which a spy can't exercise.

function OverlayPublishExitHarness({
  deps,
  startOpen = false,
  isAutoCreated = false,
  projectId = 42,
  refreshedProject = { id: 42, final_video_id: 'fv1', name: 'R', is_auto_created: false },
}) {
  const { refreshProject, onExportComplete, publish, goToProjectManager, setEditorMode, openFinishedReel, toastSuccess } = deps;
  const [showExportCompletePreview, setShowExportCompletePreview] = useState(startOpen);

  const project = { ...refreshedProject, is_auto_created: isAutoCreated };

  const handleExportComplete = useCallback(async (completed) => {
    const refreshed = await refreshProject();
    const isFocusOneTapPublish = usePublishIntentStore.getState().projectId === projectId;
    if (!isFocusOneTapPublish && refreshed?.final_video_id) {
      setShowExportCompletePreview(true);
    }
    if (onExportComplete) onExportComplete(completed);
  }, [refreshProject, onExportComplete, projectId]);

  const handlePublishNow = useCallback(async () => {
    const snapshot = project;
    const published = await publish({ openGallery: false });
    setShowExportCompletePreview(false);
    if (published) {
      toastSuccess('Published', { message: 'Anyone with the link can watch it.' });
    }
    if (snapshot?.final_video_id) {
      openFinishedReel(snapshot, { alreadyPublished: !!published });
    }
  }, [publish, project, openFinishedReel, toastSuccess]);

  const handleReapplyOverlay = useCallback(() => {
    setShowExportCompletePreview(false);
  }, []);

  const handleReapplyFocus = useCallback(() => {
    setShowExportCompletePreview(false);
    toastSuccess(OVERLAY_REAPPLY_FOCUS_TOAST.title, { message: OVERLAY_REAPPLY_FOCUS_TOAST.message });
    setEditorMode(EDITOR_MODES.FRAMING);
  }, [setEditorMode, toastSuccess]);

  const handlePublishLater = useCallback(() => {
    setShowExportCompletePreview(false);
    const copy = project?.is_auto_created ? FOCUS_PUBLISH_LATER_TOAST.SINGLE_CLIP : FOCUS_PUBLISH_LATER_TOAST.MULTI_CLIP;
    toastSuccess(copy.title, { message: copy.message, duration: 10000 });
    goToProjectManager();
  }, [project?.is_auto_created, goToProjectManager, toastSuccess]);

  return (
    <>
      <button onClick={() => handleExportComplete({ projectId, mode: 'overlay' })}>fire-export-complete</button>
      {showExportCompletePreview && project?.final_video_id && (
        <div data-testid="export-complete-preview">
          <OverlayPublishActionBar
            onPublishNow={handlePublishNow}
            onReapplyOverlay={handleReapplyOverlay}
            onReapplyFocus={handleReapplyFocus}
            onSaveDraft={handlePublishLater}
          />
        </div>
      )}
    </>
  );
}

function makeDeps({ published = true, refreshed = { id: 42, final_video_id: 'fv1', name: 'R' } } = {}) {
  return {
    refreshProject: vi.fn().mockResolvedValue(refreshed),
    onExportComplete: vi.fn(),
    publish: vi.fn().mockResolvedValue(published),
    goToProjectManager: vi.fn(),
    setEditorMode: vi.fn(),
    openFinishedReel: vi.fn(),
    toastSuccess: vi.fn(),
  };
}

describe('T9110 Overlay post-export completion preview + publish-exit action bar', () => {
  beforeEach(() => usePublishIntentStore.getState().clear());
  afterEach(() => usePublishIntentStore.getState().clear());

  it('on a plain overlay export (no publish intent): raises the preview and still calls App onExportComplete', async () => {
    const deps = makeDeps();
    render(<OverlayPublishExitHarness deps={deps} projectId={42} />);

    expect(screen.queryByTestId('export-complete-preview')).toBeNull();
    fireEvent.click(screen.getByText('fire-export-complete'));

    await waitFor(() => expect(screen.getByTestId('export-complete-preview')).toBeTruthy());
    expect(deps.onExportComplete).toHaveBeenCalledTimes(1);
  });

  it('does NOT raise the preview when a publish intent is staked (Focus one-tap Publish — App.jsx owns it)', async () => {
    const deps = makeDeps();
    usePublishIntentStore.getState().set(42);
    render(<OverlayPublishExitHarness deps={deps} projectId={42} />);

    fireEvent.click(screen.getByText('fire-export-complete'));

    await waitFor(() => expect(deps.onExportComplete).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('export-complete-preview')).toBeNull();
  });

  it('does NOT raise the preview when the refreshed project has no final_video_id', async () => {
    const deps = makeDeps({ refreshed: { id: 42, final_video_id: null } });
    render(<OverlayPublishExitHarness deps={deps} projectId={42} refreshedProject={{ id: 42, final_video_id: null }} />);

    fireEvent.click(screen.getByText('fire-export-complete'));

    await waitFor(() => expect(deps.onExportComplete).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('export-complete-preview')).toBeNull();
  });

  it('renders all four choices, no "skip" text', () => {
    const deps = makeDeps();
    render(<OverlayPublishExitHarness deps={deps} startOpen />);

    expect(screen.getByRole('button', { name: OVERLAY_PUBLISH.PUBLISH_LABEL })).toBeTruthy();
    expect(screen.getByRole('button', { name: OVERLAY_PUBLISH.REAPPLY_OVERLAY_LABEL })).toBeTruthy();
    expect(screen.getByRole('button', { name: OVERLAY_PUBLISH.REAPPLY_FOCUS_LABEL })).toBeTruthy();
    expect(screen.getByRole('button', { name: OVERLAY_PUBLISH.SAVE_DRAFT_LABEL })).toBeTruthy();

    const panel = screen.getByTestId('export-complete-preview');
    expect(panel.textContent.toLowerCase()).not.toContain('skip');
  });

  it('"Publish Now" publishes, toasts Published, lands on the reel (alreadyPublished), and closes — no re-export', async () => {
    const deps = makeDeps({ published: true });
    render(<OverlayPublishExitHarness deps={deps} startOpen />);

    fireEvent.click(screen.getByRole('button', { name: OVERLAY_PUBLISH.PUBLISH_LABEL }));

    await waitFor(() => expect(deps.publish).toHaveBeenCalledWith({ openGallery: false }));
    await waitFor(() => expect(screen.queryByTestId('export-complete-preview')).toBeNull());
    expect(deps.toastSuccess).toHaveBeenCalledWith('Published', expect.objectContaining({ message: expect.any(String) }));
    expect(deps.openFinishedReel).toHaveBeenCalledWith(
      expect.objectContaining({ final_video_id: 'fv1' }),
      { alreadyPublished: true },
    );
    // Nothing re-exported: the final video already existed.
    expect(deps.setEditorMode).not.toHaveBeenCalled();
  });

  it('"Publish Now" on a failed publish still closes + lands, but fires no Published toast', async () => {
    const deps = makeDeps({ published: false });
    render(<OverlayPublishExitHarness deps={deps} startOpen />);

    fireEvent.click(screen.getByRole('button', { name: OVERLAY_PUBLISH.PUBLISH_LABEL }));

    await waitFor(() => expect(deps.publish).toHaveBeenCalled());
    expect(deps.toastSuccess).not.toHaveBeenCalled();
    expect(deps.openFinishedReel).toHaveBeenCalledWith(expect.any(Object), { alreadyPublished: false });
  });

  it('"Reapply Overlay" (and the X/onClose it also drives) just closes the preview — no toast/navigation/publish', () => {
    const deps = makeDeps();
    render(<OverlayPublishExitHarness deps={deps} startOpen />);

    fireEvent.click(screen.getByRole('button', { name: OVERLAY_PUBLISH.REAPPLY_OVERLAY_LABEL }));

    expect(screen.queryByTestId('export-complete-preview')).toBeNull();
    expect(deps.toastSuccess).not.toHaveBeenCalled();
    expect(deps.goToProjectManager).not.toHaveBeenCalled();
    expect(deps.setEditorMode).not.toHaveBeenCalled();
    expect(deps.publish).not.toHaveBeenCalled();
  });

  it('"Reapply Focus" confirms via toast and switches to Focus/framing mode; no publish, no home nav', () => {
    const deps = makeDeps();
    render(<OverlayPublishExitHarness deps={deps} startOpen />);

    fireEvent.click(screen.getByRole('button', { name: OVERLAY_PUBLISH.REAPPLY_FOCUS_LABEL }));

    expect(deps.toastSuccess).toHaveBeenCalledWith(
      OVERLAY_REAPPLY_FOCUS_TOAST.title,
      expect.objectContaining({ message: OVERLAY_REAPPLY_FOCUS_TOAST.message }),
    );
    expect(deps.setEditorMode).toHaveBeenCalledWith(EDITOR_MODES.FRAMING);
    expect(deps.publish).not.toHaveBeenCalled();
    expect(deps.goToProjectManager).not.toHaveBeenCalled();
  });

  it('"Save draft" shows the MULTI-CLIP toast and navigates home; no publish, no re-export', () => {
    const deps = makeDeps();
    render(<OverlayPublishExitHarness deps={deps} startOpen isAutoCreated={false} />);

    fireEvent.click(screen.getByRole('button', { name: OVERLAY_PUBLISH.SAVE_DRAFT_LABEL }));

    expect(deps.toastSuccess).toHaveBeenCalledWith(
      'Saved to Highlight Reels, under Highlights',
      expect.objectContaining({ duration: 10000 }),
    );
    expect(deps.goToProjectManager).toHaveBeenCalledTimes(1);
    expect(deps.publish).not.toHaveBeenCalled();
    expect(deps.setEditorMode).not.toHaveBeenCalled();
  });

  it('"Save draft" shows the SINGLE-CLIP toast when is_auto_created', () => {
    const deps = makeDeps();
    render(<OverlayPublishExitHarness deps={deps} startOpen isAutoCreated />);

    fireEvent.click(screen.getByRole('button', { name: OVERLAY_PUBLISH.SAVE_DRAFT_LABEL }));

    expect(deps.toastSuccess).toHaveBeenCalledWith('Saved to Clips', expect.objectContaining({ duration: 10000 }));
  });
});
