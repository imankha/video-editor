import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { useState, useCallback } from 'react';
import { FocusPublishActionBar } from '../../components/FocusPublishActionBar';
import { FOCUS_PUBLISH, FOCUS_PUBLISH_LATER_TOAST, FOCUS_ADD_SPOTLIGHT_TOAST } from '../../config/displayNames';
import { usePublishIntentStore } from '../../stores/publishIntentStore';
import { scheduleExportWhenReady } from '../../utils/scheduleExportWhenReady';

// T8390: FocusScreen is a very large screen that cannot be mounted in isolation
// (dozens of stores/hooks/contexts). This test harness reproduces the post-export
// preview + publish-exit action bar exactly as FocusScreen renders it (supersedes
// T8520's exportCompleteChoice.test.jsx, whose 3-button card this task replaced),
// plus the four gesture handlers verbatim, wired to injectable spies. It asserts
// the WIRING CONTRACT: which store call, toast, and navigation each choice fires,
// and that the render trigger is deferred. The action bar render (labels,
// data-tutorial-target) is real (FocusPublishActionBar, not reproduced).
//
// Publish-intent staking goes through the REAL usePublishIntentStore (not a
// spy) because the re-entrancy guard + timeout-expiry Reviewer flagged (T8390
// review) are conditional on the store's actual current value — a spy can't
// exercise that branch.
//
// T9740: the render trigger is no longer a bare 500ms timer — it's
// scheduleExportWhenReady polling `deps.isReady()` (real function, mirrors
// FocusScreen's `!!exportButtonRef.current`). Tests control readiness via
// `deps.isReady`, not a fixed timer advance; see scheduleExportWhenReady.test.js
// for the scheduler's own unit coverage in isolation.

const PUBLISH_INTENT_TIMEOUT_MS = 5 * 60 * 1000;
const POLL_INTERVAL_MS = 150;

/**
 * Mirrors FocusScreen's post-export preview + publish-exit action bar. `deps`
 * injects the same store actions FocusScreen calls through getState(), so we
 * can spy on them.
 */
function FocusPublishExitHarness({ deps, startOpen = false, isAutoCreated = false, projectId = 42 }) {
  const { setEditorMode, recordAchievement, goToProjectManager, triggerExport, toastSuccess, isReady } = deps;
  const [showExportCompletePreview, setShowExportCompletePreview] = useState(startOpen);

  // The gesture-driven completion callback (export finished).
  const onExportComplete = useCallback(() => {
    setShowExportCompletePreview(true);
    recordAchievement('overlay_offered');
  }, [recordAchievement]);

  const handleAddSpotlight = useCallback(() => {
    setShowExportCompletePreview(false);
    if (usePublishIntentStore.getState().projectId === projectId) usePublishIntentStore.getState().clear();
    toastSuccess(FOCUS_ADD_SPOTLIGHT_TOAST.title, { message: FOCUS_ADD_SPOTLIGHT_TOAST.message });
    setEditorMode('overlay');
  }, [setEditorMode, projectId, toastSuccess]);

  const handleAddSpotlightLater = useCallback(() => {
    setShowExportCompletePreview(false);
    if (usePublishIntentStore.getState().projectId === projectId) usePublishIntentStore.getState().clear();
    recordAchievement('overlay_deferred');
    const copy = isAutoCreated ? FOCUS_PUBLISH_LATER_TOAST.SINGLE_CLIP : FOCUS_PUBLISH_LATER_TOAST.MULTI_CLIP;
    toastSuccess(copy.title, { message: copy.message, duration: 10000 });
    goToProjectManager();
  }, [recordAchievement, goToProjectManager, toastSuccess, isAutoCreated, projectId]);

  const handlePublish = useCallback(() => {
    if (usePublishIntentStore.getState().projectId === projectId) return;
    setShowExportCompletePreview(false);
    // Real handlePublish also calls setExportPreviewUrl(null) here (T9100)
    // — omitted deliberately, this harness has no export-preview URL state.
    recordAchievement('overlay_declined');
    usePublishIntentStore.getState().set(projectId);
    setTimeout(() => {
      if (usePublishIntentStore.getState().projectId === projectId) usePublishIntentStore.getState().clear();
    }, PUBLISH_INTENT_TIMEOUT_MS);
    setEditorMode('overlay');
    scheduleExportWhenReady({
      isReady,
      fire: triggerExport,
      shouldContinue: () => usePublishIntentStore.getState().projectId === projectId,
      intervalMs: POLL_INTERVAL_MS,
    });
  }, [recordAchievement, setEditorMode, triggerExport, projectId, isReady]);

  const handleRefocus = useCallback(() => {
    setShowExportCompletePreview(false);
    if (usePublishIntentStore.getState().projectId === projectId) usePublishIntentStore.getState().clear();
  }, [projectId]);

  return (
    <>
      <button onClick={onExportComplete}>fire-export-complete</button>
      {showExportCompletePreview && (
        <div data-testid="export-complete-preview">
          <FocusPublishActionBar
            onPublish={handlePublish}
            onAddSpotlight={handleAddSpotlight}
            onRefocus={handleRefocus}
            onSaveDraft={handleAddSpotlightLater}
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
    toastSuccess: vi.fn(),
    // Defaults to "never ready" so tests that don't care about the render
    // trigger (Add Spotlight, Save draft, Edit framing) can assert
    // triggerExport is never called without racing the poll.
    isReady: vi.fn().mockReturnValue(false),
  };
}

describe('T8390 post-export preview + publish-exit action bar', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    usePublishIntentStore.getState().clear();
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    usePublishIntentStore.getState().clear();
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

    expect(screen.getByRole('button', { name: FOCUS_PUBLISH.PUBLISH_LABEL })).toBeTruthy();
    expect(screen.getByRole('button', { name: FOCUS_PUBLISH.ADD_SPOTLIGHT_LABEL })).toBeTruthy();
    expect(screen.getByRole('button', { name: FOCUS_PUBLISH.SAVE_DRAFT_LABEL })).toBeTruthy();
    expect(screen.getByRole('button', { name: FOCUS_PUBLISH.EDIT_FRAMING_LABEL })).toBeTruthy();

    const panel = screen.getByTestId('export-complete-preview');
    expect(panel.textContent.toLowerCase()).not.toContain('skip');
  });

  it('"Add Spotlight Now" switches to overlay mode, confirms via toast, fires no deferred/declined event', () => {
    const deps = makeDeps();
    render(<FocusPublishExitHarness deps={deps} startOpen />);

    fireEvent.click(screen.getByRole('button', { name: FOCUS_PUBLISH.ADD_SPOTLIGHT_LABEL }));

    expect(deps.setEditorMode).toHaveBeenCalledWith('overlay');
    expect(deps.recordAchievement).not.toHaveBeenCalled();
    expect(deps.goToProjectManager).not.toHaveBeenCalled();
    expect(deps.triggerExport).not.toHaveBeenCalled();
    expect(usePublishIntentStore.getState().projectId).toBeNull();
    // 2026-09-08: every action-bar choice confirms what happened + what's next.
    expect(deps.toastSuccess).toHaveBeenCalledWith(
      FOCUS_ADD_SPOTLIGHT_TOAST.title,
      expect.objectContaining({ message: FOCUS_ADD_SPOTLIGHT_TOAST.message }),
    );
  });

  it('"Save draft" records overlay_deferred, shows the MULTI-CLIP toast, and navigates home; no render', () => {
    const deps = makeDeps();
    render(<FocusPublishExitHarness deps={deps} startOpen isAutoCreated={false} />);

    fireEvent.click(screen.getByRole('button', { name: FOCUS_PUBLISH.SAVE_DRAFT_LABEL }));

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

  it('"Save draft" shows the SINGLE-CLIP toast when is_auto_created', () => {
    const deps = makeDeps();
    render(<FocusPublishExitHarness deps={deps} startOpen isAutoCreated />);

    fireEvent.click(screen.getByRole('button', { name: FOCUS_PUBLISH.SAVE_DRAFT_LABEL }));

    expect(deps.toastSuccess).toHaveBeenCalledWith(
      'Saved to Clips',
      expect.objectContaining({ duration: 10000 }),
    );
  });

  it('Edit framing (and the X/onClose it also drives) just closes the preview — no achievement/toast/navigation', () => {
    const deps = makeDeps();
    render(<FocusPublishExitHarness deps={deps} startOpen />);

    fireEvent.click(screen.getByRole('button', { name: FOCUS_PUBLISH.EDIT_FRAMING_LABEL }));

    expect(screen.queryByTestId('export-complete-preview')).toBeNull();
    expect(deps.recordAchievement).not.toHaveBeenCalled();
    expect(deps.goToProjectManager).not.toHaveBeenCalled();
    expect(deps.setEditorMode).not.toHaveBeenCalled();
    expect(deps.toastSuccess).not.toHaveBeenCalled();
  });

  it('"Publish" records overlay_declined, stakes the publish intent, switches to overlay, and triggers the render once the export button becomes ready', () => {
    const deps = makeDeps();
    render(<FocusPublishExitHarness deps={deps} startOpen projectId={42} />);

    fireEvent.click(screen.getByRole('button', { name: FOCUS_PUBLISH.PUBLISH_LABEL }));

    expect(deps.recordAchievement).toHaveBeenCalledTimes(1);
    expect(deps.recordAchievement).toHaveBeenCalledWith('overlay_declined');
    expect(usePublishIntentStore.getState().projectId).toBe(42);
    expect(deps.setEditorMode).toHaveBeenCalledWith('overlay');
    // Render is deferred until the overlay export button mounts.
    expect(deps.triggerExport).not.toHaveBeenCalled();

    // T9740: not ready yet — even well past the OLD fixed 500ms delay, a
    // still-hydrating workingVideo must not leave the trigger stranded.
    act(() => { vi.advanceTimersByTime(2000); });
    expect(deps.triggerExport).not.toHaveBeenCalled();

    // The overlay export button finally mounts (workingVideo hydrated).
    deps.isReady.mockReturnValue(true);
    act(() => { vi.advanceTimersByTime(POLL_INTERVAL_MS); });
    expect(deps.triggerExport).toHaveBeenCalledTimes(1);
  });

  it('T9740: stake cleared (e.g. Refocus) before the export button becomes ready stops the poll — triggerExport never fires', () => {
    const deps = makeDeps();
    render(<FocusPublishExitHarness deps={deps} startOpen projectId={42} />);

    fireEvent.click(screen.getByRole('button', { name: FOCUS_PUBLISH.PUBLISH_LABEL }));
    expect(usePublishIntentStore.getState().projectId).toBe(42);

    // User backs out before the gate ever opens.
    usePublishIntentStore.getState().clear();
    act(() => { vi.advanceTimersByTime(5000); });

    expect(deps.triggerExport).not.toHaveBeenCalled();
  });

  it('T9740: a hydration that never completes relies on the existing 5-minute safety net, not a new deadline — no fire, no leaked timer', () => {
    const deps = makeDeps();
    render(<FocusPublishExitHarness deps={deps} startOpen projectId={42} />);

    fireEvent.click(screen.getByRole('button', { name: FOCUS_PUBLISH.PUBLISH_LABEL }));

    // One extra interval past the timeout so the poll's next tick (which may
    // land on the very same instant as the safety-net clear) has a chance to
    // observe the cleared stake and stop, rather than racing the assertion.
    act(() => { vi.advanceTimersByTime(PUBLISH_INTENT_TIMEOUT_MS + POLL_INTERVAL_MS); });

    expect(usePublishIntentStore.getState().projectId).toBeNull();
    expect(deps.triggerExport).not.toHaveBeenCalled();
    // The poll stopped when the stake cleared — nothing left pending.
    expect(vi.getTimerCount()).toBe(0);
  });

  it('T8390 review: double-tap Publish (two clicks before the button unmounts) stakes/triggers only ONCE', () => {
    const deps = makeDeps();
    render(<FocusPublishExitHarness deps={deps} startOpen projectId={42} />);

    const publishBtn = screen.getByRole('button', { name: FOCUS_PUBLISH.PUBLISH_LABEL });
    fireEvent.click(publishBtn);
    fireEvent.click(publishBtn); // same tick, preview hasn't unmounted yet

    expect(deps.recordAchievement.mock.calls.filter((c) => c[0] === 'overlay_declined')).toHaveLength(1);
    expect(deps.setEditorMode).toHaveBeenCalledTimes(1);

    deps.isReady.mockReturnValue(true);
    act(() => { vi.advanceTimersByTime(POLL_INTERVAL_MS); });
    expect(deps.triggerExport).toHaveBeenCalledTimes(1);
  });

  it('T8390 review: a staked publish intent expires after the safety-net timeout (bounds staleness if the render never completes)', () => {
    const deps = makeDeps();
    render(<FocusPublishExitHarness deps={deps} startOpen projectId={42} />);

    fireEvent.click(screen.getByRole('button', { name: FOCUS_PUBLISH.PUBLISH_LABEL }));
    expect(usePublishIntentStore.getState().projectId).toBe(42);

    act(() => { vi.advanceTimersByTime(PUBLISH_INTENT_TIMEOUT_MS); });
    expect(usePublishIntentStore.getState().projectId).toBeNull();
  });

  it('T8390 review: Edit framing/Add spotlight/Save draft abandon a stale publish intent for the SAME project', () => {
    const deps = makeDeps();
    usePublishIntentStore.getState().set(42);

    render(<FocusPublishExitHarness deps={deps} startOpen projectId={42} />);
    fireEvent.click(screen.getByRole('button', { name: FOCUS_PUBLISH.EDIT_FRAMING_LABEL }));

    expect(usePublishIntentStore.getState().projectId).toBeNull();
  });

  it('overlay_offered + overlay_deferred + overlay_declined still sum to one event per completion cycle (T8520 regression)', () => {
    const deps = makeDeps();
    render(<FocusPublishExitHarness deps={deps} />);

    fireEvent.click(screen.getByText('fire-export-complete'));
    fireEvent.click(screen.getByRole('button', { name: FOCUS_PUBLISH.PUBLISH_LABEL }));

    // overlay_offered (on completion) + overlay_declined (Publish) — exactly
    // one entry event and one exit event, never both deferred AND declined.
    expect(deps.recordAchievement).toHaveBeenCalledTimes(2);
    expect(deps.recordAchievement.mock.calls.map((c) => c[0])).toEqual(['overlay_offered', 'overlay_declined']);
  });
});

// T9100: the null-blob branch of handleProceedToOverlayInternal — the branch
// that runs for every real server-authoritative export (FocusScreen.jsx
// ~L1015-1033). The T8390 harness above deliberately omits it; it is exactly
// where the regression lived. Reproduced verbatim (both the fixed and the
// pre-T9100 buggy shape) so we can pin THE WRITE CONTRACT: the shared
// projectDataStore.workingVideo record must NEVER be seeded with a `url` but a
// falsy `metadata` — that violated "a workingVideo record with a url always has
// metadata" and poisoned effectiveOverlayMetadata for the whole session
// (misaligned detection boxes AND corrupted persisted spotlight geometry).
async function runNullBlobBranch({ deps, buggy = false, projectId = 42 }) {
  const {
    setWorkingVideo,
    setIsLoadingWorkingVideo,
    setExportPreviewUrl,
    refreshProject,
    resolveWorkingVideoPreviewUrl,
  } = deps;

  // --- verbatim from the else / null-blob branch ---
  setIsLoadingWorkingVideo(true);
  setWorkingVideo(null);
  await refreshProject();
  const previewUrl = await resolveWorkingVideoPreviewUrl(projectId);
  if (previewUrl) {
    if (buggy) {
      // Pre-T9100 (commit 6ab3f5c1): url without metadata — the regression.
      setWorkingVideo({ file: null, url: previewUrl, metadata: null });
    } else {
      // T9100 fix: hold the ephemeral URL in local view state instead.
      setExportPreviewUrl(previewUrl);
    }
  }
  // --- end branch ---
}

/**
 * The write contract itself: for every workingVideo record ever written, a
 * truthy `url` implies a truthy `metadata`. Throws (test fails) on violation.
 */
function assertWorkingVideoUrlAlwaysHasMetadata(setWorkingVideo) {
  for (const [record] of setWorkingVideo.mock.calls) {
    if (record && record.url) {
      expect(record.metadata).toBeTruthy();
    }
  }
}

function makeBranchDeps() {
  return {
    setWorkingVideo: vi.fn(),
    setIsLoadingWorkingVideo: vi.fn(),
    setExportPreviewUrl: vi.fn(),
    refreshProject: vi.fn().mockResolvedValue(undefined),
    resolveWorkingVideoPreviewUrl: vi.fn().mockResolvedValue('blob:preview-url'),
  };
}

describe('T9100 export->overlay handoff: workingVideo write contract', () => {
  it('the null-blob branch NEVER writes a url without metadata into workingVideo; the preview URL goes to local view state, and the loading signal is left for OverlayScreen to clear', async () => {
    const deps = makeBranchDeps();

    await runNullBlobBranch({ deps });

    // The ephemeral preview URL is routed to local view state, not the store.
    expect(deps.setExportPreviewUrl).toHaveBeenCalledWith('blob:preview-url');
    // workingVideo is reset to null and never re-seeded with a partial record.
    expect(deps.setWorkingVideo).toHaveBeenCalledTimes(1);
    expect(deps.setWorkingVideo).toHaveBeenCalledWith(null);
    // The loading flag stays SET so OverlayScreen's real loader clears it.
    expect(deps.setIsLoadingWorkingVideo).toHaveBeenCalledWith(true);
    // The invariant.
    assertWorkingVideoUrlAlwaysHasMetadata(deps.setWorkingVideo);
  });

  it('negative control: the pre-T9100 buggy branch DOES seed url-without-metadata, so the contract assertion catches it', async () => {
    const deps = makeBranchDeps();

    await runNullBlobBranch({ deps, buggy: true });

    // Prove the buggy branch produces exactly the poisoned record...
    expect(deps.setWorkingVideo).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'blob:preview-url', metadata: null }),
    );
    // ...and that the contract assertion above would have FAILED on it (proving
    // the regression test actually discriminates the bug from the fix).
    expect(() => assertWorkingVideoUrlAlwaysHasMetadata(deps.setWorkingVideo)).toThrow();
  });
});
