import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { useState, useCallback } from 'react';
import { FocusPublishActionBar } from '../../components/FocusPublishActionBar';
import { FOCUS_PUBLISH_LATER_TOAST } from '../../config/displayNames';

// T8390: FocusScreen is a very large screen that cannot be mounted in isolation
// (dozens of stores/hooks/contexts). This test harness reproduces the post-export
// preview + publish-exit action bar exactly as FocusScreen renders it (supersedes
// T8520's exportCompleteChoice.test.jsx, whose 3-button card this task replaced),
// plus the four gesture handlers verbatim, wired to injectable spies. It asserts
// the WIRING CONTRACT: which store call, toast, and navigation each choice fires,
// and that the render trigger is deferred. The action bar render (labels,
// data-tutorial-target) is real (FocusPublishActionBar, not reproduced).

/**
 * Mirrors FocusScreen's post-export preview + publish-exit action bar. `deps`
 * injects the same store actions FocusScreen calls through getState(), so we
 * can spy on them.
 */
function FocusPublishExitHarness({ deps, startOpen = false, isAutoCreated = false }) {
  const { setEditorMode, recordAchievement, goToProjectManager, triggerExport, stakePublishIntent, toastSuccess } = deps;
  const [showExportCompletePreview, setShowExportCompletePreview] = useState(startOpen);

  // The gesture-driven completion callback (export finished).
  const onExportComplete = useCallback(() => {
    setShowExportCompletePreview(true);
    recordAchievement('overlay_offered');
  }, [recordAchievement]);

  const handleAddSpotlight = useCallback(() => {
    setShowExportCompletePreview(false);
    setEditorMode('overlay');
  }, [setEditorMode]);

  const handleAddSpotlightLater = useCallback(() => {
    setShowExportCompletePreview(false);
    recordAchievement('overlay_deferred');
    const copy = isAutoCreated ? FOCUS_PUBLISH_LATER_TOAST.SINGLE_CLIP : FOCUS_PUBLISH_LATER_TOAST.MULTI_CLIP;
    toastSuccess(copy.title, { message: copy.message, duration: 10000 });
    goToProjectManager();
  }, [recordAchievement, goToProjectManager, toastSuccess, isAutoCreated]);

  const handlePublish = useCallback(() => {
    setShowExportCompletePreview(false);
    recordAchievement('overlay_declined');
    stakePublishIntent();
    setEditorMode('overlay');
    setTimeout(() => triggerExport(), 500);
  }, [recordAchievement, stakePublishIntent, setEditorMode, triggerExport]);

  const handleRefocus = useCallback(() => {
    setShowExportCompletePreview(false);
  }, []);

  return (
    <>
      <button onClick={onExportComplete}>fire-export-complete</button>
      {showExportCompletePreview && (
        <div data-testid="export-complete-preview">
          <FocusPublishActionBar
            onPublish={handlePublish}
            onAddSpotlight={handleAddSpotlight}
            onAddSpotlightLater={handleAddSpotlightLater}
            onRefocus={handleRefocus}
          />
        </div>
      )}
    </>
  );
}

function makeDeps() {
  return {
    setEditorMode: vi.fn(),
    recordAchievement: vi.fn(),
    goToProjectManager: vi.fn(),
    triggerExport: vi.fn(),
    stakePublishIntent: vi.fn(),
    toastSuccess: vi.fn(),
  };
}

describe('T8390 post-export preview + publish-exit action bar', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('on completion: shows the preview, records overlay_offered once, and does NOT switch editorMode', () => {
    const deps = makeDeps();
    render(<FocusPublishExitHarness deps={deps} />);

    expect(screen.queryByTestId('export-complete-preview')).toBeNull();

    fireEvent.click(screen.getByText('fire-export-complete'));

    expect(screen.getByTestId('export-complete-preview')).toBeTruthy();
    expect(deps.recordAchievement).toHaveBeenCalledTimes(1);
    expect(deps.recordAchievement).toHaveBeenCalledWith('overlay_offered');
    expect(deps.setEditorMode).not.toHaveBeenCalled();
  });

  it('renders all four choices, no "skip" text', () => {
    const deps = makeDeps();
    render(<FocusPublishExitHarness deps={deps} startOpen />);

    expect(screen.getByRole('button', { name: 'Publish' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add Spotlight', exact: true })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add Spotlight Later' })).toBeTruthy();
    expect(screen.getByText(/^Refocus/)).toBeTruthy();

    const panel = screen.getByTestId('export-complete-preview');
    expect(panel.textContent.toLowerCase()).not.toContain('skip');
  });

  it('"Add Spotlight" switches to overlay mode and fires no deferred/declined event/toast', () => {
    const deps = makeDeps();
    render(<FocusPublishExitHarness deps={deps} startOpen />);

    fireEvent.click(screen.getByRole('button', { name: 'Add Spotlight', exact: true }));

    expect(deps.setEditorMode).toHaveBeenCalledWith('overlay');
    expect(deps.recordAchievement).not.toHaveBeenCalled();
    expect(deps.goToProjectManager).not.toHaveBeenCalled();
    expect(deps.triggerExport).not.toHaveBeenCalled();
    expect(deps.stakePublishIntent).not.toHaveBeenCalled();
    expect(deps.toastSuccess).not.toHaveBeenCalled();
  });

  it('"Add Spotlight Later" records overlay_deferred, shows the MULTI-CLIP toast, and navigates home; no render', () => {
    const deps = makeDeps();
    render(<FocusPublishExitHarness deps={deps} startOpen isAutoCreated={false} />);

    fireEvent.click(screen.getByRole('button', { name: 'Add Spotlight Later' }));

    expect(deps.recordAchievement).toHaveBeenCalledTimes(1);
    expect(deps.recordAchievement).toHaveBeenCalledWith('overlay_deferred');
    expect(deps.toastSuccess).toHaveBeenCalledWith(
      'Saved to Highlight Reels, under Highlights',
      expect.objectContaining({ duration: 10000 }),
    );
    expect(deps.goToProjectManager).toHaveBeenCalledTimes(1);
    expect(deps.setEditorMode).not.toHaveBeenCalled();
    expect(deps.triggerExport).not.toHaveBeenCalled();
  });

  it('"Add Spotlight Later" shows the SINGLE-CLIP toast when is_auto_created', () => {
    const deps = makeDeps();
    render(<FocusPublishExitHarness deps={deps} startOpen isAutoCreated />);

    fireEvent.click(screen.getByRole('button', { name: 'Add Spotlight Later' }));

    expect(deps.toastSuccess).toHaveBeenCalledWith(
      'Saved to Clips',
      expect.objectContaining({ duration: 10000 }),
    );
  });

  it('Refocus (and the X/onClose it also drives) just closes the preview — no achievement/toast/navigation', () => {
    const deps = makeDeps();
    render(<FocusPublishExitHarness deps={deps} startOpen />);

    fireEvent.click(screen.getByText(/^Refocus/));

    expect(screen.queryByTestId('export-complete-preview')).toBeNull();
    expect(deps.recordAchievement).not.toHaveBeenCalled();
    expect(deps.goToProjectManager).not.toHaveBeenCalled();
    expect(deps.setEditorMode).not.toHaveBeenCalled();
    expect(deps.toastSuccess).not.toHaveBeenCalled();
  });

  it('"Publish" records overlay_declined, stakes the publish intent, switches to overlay, and triggers the render after the timer', () => {
    const deps = makeDeps();
    render(<FocusPublishExitHarness deps={deps} startOpen />);

    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));

    expect(deps.recordAchievement).toHaveBeenCalledTimes(1);
    expect(deps.recordAchievement).toHaveBeenCalledWith('overlay_declined');
    expect(deps.stakePublishIntent).toHaveBeenCalledTimes(1);
    expect(deps.setEditorMode).toHaveBeenCalledWith('overlay');
    // Render is deferred until the overlay export button mounts.
    expect(deps.triggerExport).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(deps.triggerExport).toHaveBeenCalledTimes(1);
  });

  it('overlay_offered + overlay_deferred + overlay_declined still sum to one event per completion cycle (T8520 regression)', () => {
    const deps = makeDeps();
    render(<FocusPublishExitHarness deps={deps} />);

    fireEvent.click(screen.getByText('fire-export-complete'));
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));

    // overlay_offered (on completion) + overlay_declined (Publish) — exactly
    // one entry event and one exit event, never both deferred AND declined.
    expect(deps.recordAchievement).toHaveBeenCalledTimes(2);
    expect(deps.recordAchievement.mock.calls.map((c) => c[0])).toEqual(['overlay_offered', 'overlay_declined']);
  });
});
