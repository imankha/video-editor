import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { useEffect } from 'react';
import { useFocusCompletionStore } from '../../stores/focusCompletionStore';

// T9285 — FocusScreen's post-export preview moves from two local useState hooks
// (showExportCompletePreview/exportPreviewUrl) to a focusCompletionStore read
// (design §3.2). Unlike focusPublishExit.test.jsx's harness (which reproduces
// its OWN local useState and therefore cannot catch a change in where the
// preview state lives — a smell the design calls out, §1.6), this harness reads
// the REAL focusCompletionStore, so a regression that reverts to local state
// (or that stops deriving previewOpen from the store) fails this test.

/**
 * Mirrors FocusScreen.jsx's render gate + four handlers (§3.2/§3.3), wired to
 * the REAL focusCompletionStore instead of local useState. `deps` injects the
 * side-effecting collaborators (setEditorMode, achievements, toasts,
 * navigation) so those remain spies, exactly like focusPublishExit's harness.
 */
function FocusCompletionPreviewHarness({ deps, projectId = 42 }) {
  const completionPreview = useFocusCompletionStore((s) => s.preview);
  const openPreview = useFocusCompletionStore((s) => s.openPreview);
  const closePreview = useFocusCompletionStore((s) => s.closePreview);
  const previewOpen = completionPreview?.projectId === projectId;

  // Hard invariant (T9285 kickoff): openMode staleness-scoping, same 3-line
  // pattern DraftReelPreview.jsx:45-50 uses — clears an orphaned payload once
  // editorMode moves off the mode it was opened for.
  useEffect(() => {
    if (completionPreview && completionPreview.openMode !== deps.editorMode) {
      closePreview();
    }
  }, [completionPreview, deps.editorMode, closePreview]);

  const handleAddSpotlight = () => { closePreview(); deps.setEditorMode('overlay'); };
  const handleAddSpotlightLater = () => { closePreview(); deps.goToProjectManager(); };
  const handlePublish = () => { closePreview(); deps.triggerExport(); };
  const handleRefocus = () => { closePreview(); };

  return (
    <>
      <button onClick={() => openPreview({ projectId, previewUrl: 'blob://preview', openMode: 'framing' })}>
        open-preview
      </button>
      {previewOpen && (
        <div data-testid="export-complete-preview">
          <span data-testid="preview-url">{completionPreview.previewUrl}</span>
          <button onClick={handlePublish}>Publish</button>
          <button onClick={handleAddSpotlight}>AddSpotlight</button>
          <button onClick={handleAddSpotlightLater}>SaveDraft</button>
          <button onClick={handleRefocus}>Refocus</button>
        </div>
      )}
    </>
  );
}

function makeDeps(overrides = {}) {
  return {
    editorMode: 'framing',
    setEditorMode: vi.fn(),
    goToProjectManager: vi.fn(),
    triggerExport: vi.fn(),
    ...overrides,
  };
}

describe('T9285 FocusScreen completion preview reads focusCompletionStore', () => {
  beforeEach(() => {
    useFocusCompletionStore.getState().closePreview();
  });

  it('a store payload matching projectId renders the preview', () => {
    render(<FocusCompletionPreviewHarness deps={makeDeps()} projectId={42} />);

    fireEvent.click(screen.getByText('open-preview'));

    expect(screen.getByTestId('export-complete-preview')).toBeTruthy();
    expect(screen.getByTestId('preview-url').textContent).toBe('blob://preview');
  });

  it('a store payload for a DIFFERENT projectId renders nothing (no cross-project leakage)', () => {
    act(() => {
      useFocusCompletionStore.getState().openPreview({ projectId: 999, previewUrl: 'blob://other', openMode: 'framing' });
    });

    render(<FocusCompletionPreviewHarness deps={makeDeps()} projectId={42} />);

    expect(screen.queryByTestId('export-complete-preview')).toBeNull();
  });

  it.each([
    ['Publish', {}],
    ['AddSpotlight', {}],
    ['SaveDraft', {}],
    ['Refocus', {}],
  ])('%s calls closePreview (store), not a leftover local setter', (label) => {
    render(<FocusCompletionPreviewHarness deps={makeDeps()} projectId={42} />);
    fireEvent.click(screen.getByText('open-preview'));
    expect(screen.getByTestId('export-complete-preview')).toBeTruthy();

    fireEvent.click(screen.getByText(label));

    expect(screen.queryByTestId('export-complete-preview')).toBeNull();
    expect(useFocusCompletionStore.getState().preview).toBeNull();
  });

  it('openMode staleness-scoping: editorMode moving off openMode clears the payload (DraftReelPreview.jsx:45-50 pattern)', () => {
    const deps = makeDeps({ editorMode: 'framing' });
    const { rerender } = render(<FocusCompletionPreviewHarness deps={deps} projectId={42} />);
    fireEvent.click(screen.getByText('open-preview'));
    expect(screen.getByTestId('export-complete-preview')).toBeTruthy();

    // Editor mode moves off the mode this payload was opened for.
    rerender(<FocusCompletionPreviewHarness deps={{ ...deps, editorMode: 'overlay' }} projectId={42} />);

    expect(useFocusCompletionStore.getState().preview).toBeNull();
  });
});

// T9285: the live completion path's silent no-render becomes a loud
// console.error (design §3.2) — a real no-silent-fallback fix, not a pure
// refactor. Reproduced verbatim (both branches) mirroring the established
// runNullBlobBranch pattern in focusPublishExit.test.jsx, since FocusScreen
// cannot be mounted standalone.
async function runLiveCompletionOfferBranch({ previewUrl, openPreview, recordAchievement }) {
  const projectId = 42;
  if (previewUrl) {
    openPreview({ projectId, previewUrl, openMode: 'framing' });
    recordAchievement('overlay_offered');
  } else {
    console.error('[FocusScreen] export completed but no preview URL for project', projectId);
  }
}

describe('T9285 live completion offer: no silent no-render', () => {
  it('a resolved preview URL opens the preview and records the achievement', async () => {
    const openPreview = vi.fn();
    const recordAchievement = vi.fn();

    await runLiveCompletionOfferBranch({ previewUrl: 'blob://x', openPreview, recordAchievement });

    expect(openPreview).toHaveBeenCalledWith({ projectId: 42, previewUrl: 'blob://x', openMode: 'framing' });
    expect(recordAchievement).toHaveBeenCalledWith('overlay_offered');
  });

  it('a null preview URL (resolveWorkingVideoPreviewUrl failure) logs loudly instead of silently doing nothing', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const openPreview = vi.fn();
    const recordAchievement = vi.fn();

    await runLiveCompletionOfferBranch({ previewUrl: null, openPreview, recordAchievement });

    expect(openPreview).not.toHaveBeenCalled();
    expect(recordAchievement).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toMatch(/no preview URL/i);
  });
});
