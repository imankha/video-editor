import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { useFocusCompletionStore } from '../../stores/focusCompletionStore';
import { offerFocusCompletionPreview } from '../focusCompletionOffer';

// T9285 — FocusScreen's post-export preview moves from two local useState hooks
// (showExportCompletePreview/exportPreviewUrl) to a focusCompletionStore read
// (design §3.2). Unlike focusPublishExit.test.jsx's harness (which reproduces
// its OWN local useState and therefore cannot catch a change in where the
// preview state lives — a smell the design calls out, §1.6), this harness reads
// the REAL focusCompletionStore, so a regression that reverts to local state
// (or that stops deriving previewOpen from the store) fails this test.
//
// The openMode staleness-scoping guard is NOT tested here — a review fix moved
// it out of FocusScreen (this harness's render gate can only observe it while
// mounted, which is exactly the "can never fire" bug the review caught) and
// into the always-mounted FocusCompletionRecovery. See
// components/FocusCompletionRecovery.test.jsx for that guard's real coverage.

/**
 * Mirrors FocusScreen.jsx's render gate + four handlers (§3.2/§3.3), wired to
 * the REAL focusCompletionStore instead of local useState.
 */
function FocusCompletionPreviewHarness({ deps, projectId = 42, jobId }) {
  const completionPreview = useFocusCompletionStore((s) => s.preview);
  const openPreview = useFocusCompletionStore((s) => s.openPreview);
  const closePreview = useFocusCompletionStore((s) => s.closePreview);
  const previewOpen = completionPreview?.projectId === projectId;

  // Mirrors FocusScreen.jsx's `acknowledgeCompletionJob` (T9790): read the job
  // id straight off the preview payload and acknowledge on the gesture, never
  // at raw completion time.
  const acknowledgeCompletionJob = () => {
    const id = useFocusCompletionStore.getState().preview?.jobId;
    if (id) deps.acknowledgeExportJob(id);
  };
  const handleAddSpotlight = () => { acknowledgeCompletionJob(); closePreview(); deps.setEditorMode('overlay'); };
  const handleAddSpotlightLater = () => { acknowledgeCompletionJob(); closePreview(); deps.goToProjectManager(); };
  const handlePublish = () => { acknowledgeCompletionJob(); closePreview(); deps.triggerExport(); };
  const handleRefocus = () => { acknowledgeCompletionJob(); closePreview(); };

  return (
    <>
      <button onClick={() => openPreview({ projectId, previewUrl: 'blob://preview', openMode: 'framing', jobId })}>
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
    setEditorMode: vi.fn(),
    goToProjectManager: vi.fn(),
    triggerExport: vi.fn(),
    acknowledgeExportJob: vi.fn(),
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
});

// T9790: the live completion path never acknowledged its framing job, so every
// live completion stayed unacknowledged for the full 24h window and re-prompted
// as "recoverable" on any reload. The fix threads the job id onto the preview
// payload and acknowledges it on whichever of the four decision gestures the
// user picks — and ONLY then, never at raw completion time (preserving §6a: a
// tab discard before the user acts still re-prompts).
describe('T9790 live path acknowledges the framing job on the decision gesture', () => {
  beforeEach(() => {
    useFocusCompletionStore.getState().closePreview();
  });

  it('offering the preview (raw completion) does NOT acknowledge — only the gesture does', () => {
    const openPreview = vi.fn();
    const recordAchievement = vi.fn();
    const acknowledgeExportJob = vi.fn();

    // offerFocusCompletionPreview is the live path's completion-time step.
    offerFocusCompletionPreview({
      projectId: 42, previewUrl: 'blob://x', openMode: 'framing', jobId: 'job-live-1', openPreview, recordAchievement,
    });

    // It opens the preview carrying the job id, but must NOT acknowledge.
    expect(openPreview).toHaveBeenCalledWith({ projectId: 42, previewUrl: 'blob://x', openMode: 'framing', jobId: 'job-live-1' });
    expect(acknowledgeExportJob).not.toHaveBeenCalled();
  });

  it.each([
    ['Publish'],
    ['AddSpotlight'],
    ['SaveDraft'],
    ['Refocus'],
  ])('%s acknowledges the job id carried on the preview payload', (label) => {
    const deps = makeDeps();
    render(<FocusCompletionPreviewHarness deps={deps} projectId={42} jobId="job-live-2" />);
    fireEvent.click(screen.getByText('open-preview'));
    expect(screen.getByTestId('export-complete-preview')).toBeTruthy();
    expect(deps.acknowledgeExportJob).not.toHaveBeenCalled(); // not at completion

    fireEvent.click(screen.getByText(label));

    expect(deps.acknowledgeExportJob).toHaveBeenCalledTimes(1);
    expect(deps.acknowledgeExportJob).toHaveBeenCalledWith('job-live-2');
  });

  it('a gesture with no job id on the payload is a no-op, never a bad acknowledge request', () => {
    const deps = makeDeps();
    render(<FocusCompletionPreviewHarness deps={deps} projectId={42} jobId={undefined} />);
    fireEvent.click(screen.getByText('open-preview'));

    fireEvent.click(screen.getByText('Publish'));

    expect(deps.acknowledgeExportJob).not.toHaveBeenCalled();
  });
});

// T9285 review fix: the previous version of this suite tested
// `runLiveCompletionOfferBranch`, a verbatim COPY of FocusScreen's decision
// logic defined inside the test file itself — reverting the real FocusScreen
// change (or breaking `offerFocusCompletionPreview`) would have left it green.
// FocusScreen's null-blob branch now calls the REAL, extracted
// `offerFocusCompletionPreview` (screens/focusCompletionOffer.js), so this
// drives that real import directly — no duplicated logic.
describe('T9285 offerFocusCompletionPreview: no silent no-render (real import)', () => {
  it('a resolved preview URL opens the preview and records the achievement', () => {
    const openPreview = vi.fn();
    const recordAchievement = vi.fn();

    const opened = offerFocusCompletionPreview({
      projectId: 42, previewUrl: 'blob://x', openMode: 'framing', openPreview, recordAchievement,
    });

    expect(opened).toBe(true);
    expect(openPreview).toHaveBeenCalledWith({ projectId: 42, previewUrl: 'blob://x', openMode: 'framing' });
    expect(recordAchievement).toHaveBeenCalledWith('overlay_offered');
  });

  it('a null preview URL (resolveWorkingVideoPreviewUrl failure) logs loudly instead of silently doing nothing', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const openPreview = vi.fn();
    const recordAchievement = vi.fn();

    const opened = offerFocusCompletionPreview({
      projectId: 42, previewUrl: null, openMode: 'framing', openPreview, recordAchievement,
    });

    expect(opened).toBe(false);
    expect(openPreview).not.toHaveBeenCalled();
    expect(recordAchievement).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toMatch(/no preview URL/i);
  });
});
