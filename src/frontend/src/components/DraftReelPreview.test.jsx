import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// T10180: DraftReelPreview is being rewired from the two-flag (published/failed)
// publish->share model to a `phase` state machine (idle/review/publishing/ready/
// failed) with a visibility-review confirm step and a distinct link-ready state
// that shows the share URL BEFORE any copy. See docs/plans/tasks/T10180-design.md.
//
// apiFetch + store fns for the publish path (usePublishProject).
const { apiFetchMock, fetchProjectsMock, toastSuccessMock, toastErrorMock, createShareLinkMock, webShareMock, repointShareLinkMock } = vi.hoisted(() => ({
  apiFetchMock: vi.fn(),
  fetchProjectsMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
  createShareLinkMock: vi.fn(),
  webShareMock: vi.fn(),
  repointShareLinkMock: vi.fn(),
}));

vi.mock('../utils/apiFetch', () => ({ default: (...a) => apiFetchMock(...a) }));
vi.mock('../stores/projectsStore', () => {
  const state = { fetchProjects: fetchProjectsMock };
  const useProjectsStore = (sel) => sel(state);
  useProjectsStore.getState = () => state;
  return { useProjectsStore };
});
const { galleryOpenMock } = vi.hoisted(() => ({ galleryOpenMock: vi.fn() }));
vi.mock('../stores/galleryStore', () => {
  const api = { fetchCount: vi.fn(), notifyCollectionsChanged: vi.fn(), open: (...a) => galleryOpenMock(...a) };
  const useGalleryStore = () => api;
  useGalleryStore.getState = () => api;
  return { useGalleryStore };
});
vi.mock('../stores/questStore', () => {
  const api = { recordAchievement: vi.fn() };
  const useQuestStore = () => api;
  useQuestStore.getState = () => api;
  return { useQuestStore };
});
vi.mock('./shared/Toast', () => ({
  toast: { success: (...a) => toastSuccessMock(...a), error: (...a) => toastErrorMock(...a) },
}));
// T10180: useWebShare gains createShareLink({ downloadId }) -> Promise<string url>,
// additive alongside the existing copyLink/webShare.
// T10860: useWebShare gains repointShareLink({ downloadId, shareToken }) ->
// Promise<string url>, additive alongside createShareLink/copyLink/webShare.
vi.mock('../hooks/useWebShare', () => ({
  useWebShare: () => ({
    copyLink: vi.fn().mockResolvedValue('clipboard'),
    webShare: webShareMock,
    createShareLink: createShareLinkMock,
    repointShareLink: repointShareLinkMock,
    isMobile: false,
  }),
}));
const { downloadsApi } = vi.hoisted(() => ({
  downloadsApi: { downloadFile: vi.fn().mockResolvedValue(undefined), downloadingId: null },
}));
vi.mock('../hooks/useDownloads', () => ({
  useDownloads: () => downloadsApi,
  default: () => downloadsApi,
}));

// Mock CollectionPlayer down to a harness that surfaces the props DraftReelPreview
// drives. T10180 stops using the state-exclusive onPublish/onShare primary slot for
// this surface and renders the whole publish->review->link-ready flow into the
// actionBar slot instead (a PublishLinkFlow component) -- the harness exposes
// statusBanner and actionBar so the flow can be driven/asserted without importing
// the real PublishLinkFlow implementation.
const { mountSpy } = vi.hoisted(() => ({ mountSpy: vi.fn() }));
vi.mock('./collections/CollectionPlayer', async () => {
  const { useEffect } = await import('react');
  return {
    // T10190: harness also surfaces onBackToGame (present/absent) and the
    // reel's gameId/gameName/gameStartTime so the gating + threading can be
    // asserted without importing the real CollectionPlayer.
    CollectionPlayer: ({ reels, statusBanner, actionBar, onClose, onDownload, downloadLoading, onBackToGame }) => {
      const streamUrl = reels[0].streamUrl;
      useEffect(() => { mountSpy(streamUrl); }, [streamUrl]);
      return (
        <div data-testid="mock-player">
          <span data-testid="stream-url">{reels[0].streamUrl}</span>
          <span data-testid="reel-game-name">{reels[0].gameName ?? ''}</span>
          <span data-testid="reel-game-start-time">{reels[0].gameStartTime ?? ''}</span>
          {statusBanner}
          {actionBar}
          {onDownload && (
            <button title="Download" disabled={downloadLoading} onClick={() => onDownload(reels[0])}>
              {downloadLoading ? 'Downloading...' : 'Download'}
            </button>
          )}
          {onBackToGame && (
            <button title="Back to game plays" onClick={onBackToGame}>Back to game plays</button>
          )}
          <button title="Close" onClick={onClose}>Close</button>
        </div>
      );
    },
  };
});

// T10190 §3.2 Shaper 2: DraftReelPreview must thread payload.gameId through to
// CollectionPlayer's reel shape AND pass onBackToGame iff payload.gameId != null,
// wired to setPendingGame(gameId, gameStartTime, sourceClipId) + navigate to
// ANNOTATE (the same gesture primitives handleEditInAnnotate in App.jsx uses).
const { setPendingGameMock, peekAnnotateOriginMock, clearAnnotateOriginMock } = vi.hoisted(() => ({
  setPendingGameMock: vi.fn(),
  peekAnnotateOriginMock: vi.fn(() => null),
  clearAnnotateOriginMock: vi.fn(),
}));
vi.mock('../utils/pendingNavigation', () => ({
  setPendingGame: (...a) => setPendingGameMock(...a),
  peekAnnotateOrigin: (...a) => peekAnnotateOriginMock(...a),
  clearAnnotateOrigin: (...a) => clearAnnotateOriginMock(...a),
}));

import { DraftReelPreview } from './DraftReelPreview';
import { useReelPreviewStore } from '../stores/reelPreviewStore';
import { useEditorStore, EDITOR_MODES } from '../stores/editorStore';

const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const snapshot = {
  projectId: 42,
  finalVideoId: 99,
  name: 'Brilliant Dribble',
  aspectRatio: '9:16',
  clipCount: 1,
  gameName: null,
  gameStartTime: null,
};

const openPreview = () => act(() => { useReelPreviewStore.getState().open(snapshot); });

describe('DraftReelPreview (T10180 phase state machine)', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    fetchProjectsMock.mockReset();
    toastSuccessMock.mockReset();
    toastErrorMock.mockReset();
    mountSpy.mockReset();
    createShareLinkMock.mockReset();
    createShareLinkMock.mockResolvedValue('https://reelballers.com/shared/tok123');
    webShareMock.mockReset();
    downloadsApi.downloadFile.mockClear();
    downloadsApi.downloadingId = null;
    act(() => useReelPreviewStore.getState().close());
  });

  // Test 1: idle shows "Get share link", cyan banner, no review card.
  it('idle phase shows "Get share link", the cyan draft banner, and no review card', () => {
    render(<DraftReelPreview />);
    openPreview();

    expect(screen.getByTestId('draft-preview-banner').textContent)
      .toMatch(/only you can see this/i);
    expect(screen.getByRole('button', { name: 'Get share link' })).toBeTruthy();
    // No review-card affordances yet.
    expect(screen.queryByText(/anyone with the link can watch/i)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Create share link' })).toBeNull();
  });

  // Test 2: click "Get share link" -> review card renders, no publish call fired.
  it('clicking "Get share link" opens the review card without publishing yet', () => {
    render(<DraftReelPreview />);
    openPreview();

    fireEvent.click(screen.getByRole('button', { name: 'Get share link' }));

    expect(screen.getByText('Share "Brilliant Dribble"?')).toBeTruthy();
    expect(screen.getByText(/anyone with the link can watch/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create share link' })).toBeTruthy();
    // No write yet: publish (apiFetch) must not have been called.
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  // Test 3: Cancel returns to idle, no write, no link created.
  it('Cancel on the review card returns to idle with no write and no link', () => {
    render(<DraftReelPreview />);
    openPreview();
    fireEvent.click(screen.getByRole('button', { name: 'Get share link' }));

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    // Back to idle: primary CTA re-appears, review card gone.
    expect(screen.getByRole('button', { name: 'Get share link' })).toBeTruthy();
    expect(screen.queryByText(/anyone with the link can watch/i)).toBeNull();
    expect(apiFetchMock).not.toHaveBeenCalled();
    expect(createShareLinkMock).not.toHaveBeenCalled();
  });

  // Test 4: Confirm calls publish then createShareLink, lands in link-ready with
  // the URL in a selectable readonly input.
  it('Confirm publishes, then creates the share link, landing in link-ready with a selectable readonly input', async () => {
    apiFetchMock.mockResolvedValueOnce(jsonResponse(200, { archived: true, final_video_id: 99 }));
    render(<DraftReelPreview />);
    openPreview();
    fireEvent.click(screen.getByRole('button', { name: 'Get share link' }));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Create share link' }));
    });

    await waitFor(() => expect(screen.getByText('Link ready')).toBeTruthy());
    expect(apiFetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/downloads\/publish\/42$/),
      expect.objectContaining({ method: 'POST' })
    );
    expect(createShareLinkMock).toHaveBeenCalledWith({ downloadId: 99 });
    // Order matters: publish before createShareLink.
    const publishCallOrder = apiFetchMock.mock.invocationCallOrder[0];
    const linkCallOrder = createShareLinkMock.mock.invocationCallOrder[0];
    expect(publishCallOrder).toBeLessThan(linkCallOrder);

    const input = screen.getByDisplayValue('https://reelballers.com/shared/tok123');
    expect(input.tagName).toBe('INPUT');
    expect(input).toHaveProperty('readOnly', true);
  });

  // Test 5: publish failure -> amber retry banner; retry re-runs the gesture;
  // link never created on failure.
  it('publish failure shows the amber retry banner, retry re-runs the gesture, and the link is never created', async () => {
    apiFetchMock.mockResolvedValueOnce(jsonResponse(503, { code: 'sync_failed', retryable: true }));
    render(<DraftReelPreview />);
    openPreview();
    fireEvent.click(screen.getByRole('button', { name: 'Get share link' }));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Create share link' }));
    });

    const banner = await screen.findByTestId('draft-preview-banner');
    expect(banner.textContent).toMatch(/couldn't save to the cloud\./i);
    expect(createShareLinkMock).not.toHaveBeenCalled();
    expect(screen.queryByText('Link ready')).toBeNull();

    // Retry re-runs the SAME gesture.
    apiFetchMock.mockResolvedValueOnce(jsonResponse(200, { archived: true, final_video_id: 99 }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    });

    await waitFor(() => expect(screen.getByText('Link ready')).toBeTruthy());
    expect(apiFetchMock).toHaveBeenCalledTimes(2);
    expect(createShareLinkMock).toHaveBeenCalledTimes(1);
  });

  // Test 6 (R5): alreadyPublished payload reaches link-ready capability without a
  // phantom review step AND without auto-creating the link on mount (no reactive
  // effect firing a network call).
  it('alreadyPublished payload skips the review step and does NOT auto-create the link on mount', async () => {
    render(<DraftReelPreview />);
    act(() => { useReelPreviewStore.getState().open({ ...snapshot, alreadyPublished: true }); });

    // No phantom review card, no draft banner, no publish CTA.
    expect(screen.queryByText(/anyone with the link can watch/i)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Get share link' })).toBeNull();
    expect(screen.queryByTestId('draft-preview-banner')).toBeNull();

    // Give any stray microtask/effect a chance to run -- must NOT have minted a link.
    await act(async () => { await Promise.resolve(); });
    expect(createShareLinkMock).not.toHaveBeenCalled();
    expect(apiFetchMock).not.toHaveBeenCalled();

    // A first Get-link click (link-ready capability) mints it on demand.
    const getLinkBtn = screen.getByRole('button', { name: /get link/i });
    await act(async () => { fireEvent.click(getLinkBtn); });
    expect(createShareLinkMock).toHaveBeenCalledTimes(1);
  });

  // Test 9: Download button wired via onDownload into CollectionPlayer; loading
  // state reflects the download-in-progress id.
  it('wires Download via onDownload, calling downloadFile(finalVideoId), and reflects downloadingId as loading', async () => {
    render(<DraftReelPreview />);
    openPreview();

    const downloadBtn = screen.getByTitle('Download');
    expect(downloadBtn.disabled).toBe(false);

    await act(async () => {
      fireEvent.click(downloadBtn);
    });
    expect(downloadsApi.downloadFile).toHaveBeenCalledWith(99);
  });

  it('shows the download button as loading while downloadingId matches the active reel', () => {
    downloadsApi.downloadingId = 99;
    render(<DraftReelPreview />);
    openPreview();
    const downloadBtn = screen.getByTitle('Download');
    expect(downloadBtn.disabled).toBe(true);
    expect(downloadBtn.textContent).toMatch(/downloading/i);
  });
});

// T10190 §3.2 Shaper 2: gameId threading + onBackToGame gating/wiring.
describe('DraftReelPreview gameId threading and onBackToGame (T10190)', () => {
  beforeEach(() => {
    setPendingGameMock.mockClear();
    act(() => useReelPreviewStore.getState().close());
    act(() => useEditorStore.getState().setEditorMode(EDITOR_MODES.PROJECT_MANAGER));
  });

  const singleGameSnapshot = {
    ...snapshot,
    gameName: 'Lakers',
    gameStartTime: 750,
    gameId: 55,
    sourceClipId: 123,
  };

  it('passes onBackToGame to CollectionPlayer when payload.gameId is present (single source game)', () => {
    render(<DraftReelPreview />);
    act(() => { useReelPreviewStore.getState().open(singleGameSnapshot); });

    expect(screen.getByTitle('Back to game plays')).toBeTruthy();
  });

  it('omits onBackToGame when payload.gameId is null (multi-game or no-game reel)', () => {
    render(<DraftReelPreview />);
    act(() => { useReelPreviewStore.getState().open({ ...snapshot, gameId: null }); });

    expect(screen.queryByTitle('Back to game plays')).toBeNull();
  });

  it('clicking Back to game plays wires to setPendingGame(gameId, gameStartTime, sourceClipId) and navigates to Annotate', () => {
    render(<DraftReelPreview />);
    act(() => { useReelPreviewStore.getState().open(singleGameSnapshot); });

    fireEvent.click(screen.getByTitle('Back to game plays'));

    expect(setPendingGameMock).toHaveBeenCalledWith(55, 750, 123);
    expect(useEditorStore.getState().editorMode).toBe(EDITOR_MODES.ANNOTATE);
  });
});

// T11990 (Q14, reversing ae11fd75c's "return to Annotate on close"): closing the
// finished-highlight viewer (X) now ALWAYS lands on Home's Finished tab with the
// new highlight listed, and always clears the Annotate breadcrumb -- regardless
// of whether an annotateOrigin match exists. "Back to game plays" (a separate,
// explicit affordance) is untouched and still goes to Annotate (covered by the
// T10190 describe block above).
describe('DraftReelPreview close lands on Home Finished tab (T11990)', () => {
  beforeEach(() => {
    setPendingGameMock.mockClear();
    peekAnnotateOriginMock.mockReset();
    peekAnnotateOriginMock.mockReturnValue(null);
    clearAnnotateOriginMock.mockClear();
    galleryOpenMock.mockClear();
    act(() => useReelPreviewStore.getState().close());
    act(() => useEditorStore.getState().setEditorMode(EDITOR_MODES.ANNOTATE));
  });

  it('close with no matching annotateOrigin lands on Project Manager with the Finished tab requested, and clears the breadcrumb', () => {
    render(<DraftReelPreview />);
    openPreview();

    fireEvent.click(screen.getByTitle('Close'));

    expect(clearAnnotateOriginMock).toHaveBeenCalled();
    expect(setPendingGameMock).not.toHaveBeenCalled();
    expect(useEditorStore.getState().editorMode).toBe(EDITOR_MODES.PROJECT_MANAGER);
    expect(galleryOpenMock).toHaveBeenCalledTimes(1);
    expect(useReelPreviewStore.getState().payload).toBeNull();
  });

  it('close with a matching annotateOrigin STILL lands on the Finished tab (no longer returns to Annotate) and clears the breadcrumb', () => {
    peekAnnotateOriginMock.mockReturnValue({ gameId: 7, sourceClipId: 99 });
    render(<DraftReelPreview />);
    openPreview();

    fireEvent.click(screen.getByTitle('Close'));

    expect(clearAnnotateOriginMock).toHaveBeenCalled();
    expect(setPendingGameMock).not.toHaveBeenCalled();
    expect(useEditorStore.getState().editorMode).toBe(EDITOR_MODES.PROJECT_MANAGER);
    expect(galleryOpenMock).toHaveBeenCalledTimes(1);
  });
});

// T10860 (design §8 items 5-6): "Update shared version" affordance, driven by
// payload.staleShare (a plain snapshot field riding the already-fetched
// project row -- NO new fetch/effect on mount, per Invariant 1).
describe('DraftReelPreview "Update shared version" affordance (T10860)', () => {
  const staleShare = { share_token: 'stale-tok-1', old_filename: 'v1.mp4' };

  beforeEach(() => {
    repointShareLinkMock.mockReset();
    repointShareLinkMock.mockResolvedValue({
      shareUrl: 'https://reelballers.com/shared/stale-tok-1', changed: true,
    });
    apiFetchMock.mockReset();
    fetchProjectsMock.mockReset();
    toastSuccessMock.mockReset();
    toastErrorMock.mockReset();
    act(() => useReelPreviewStore.getState().close());
  });

  it('renders "Update shared version" when payload.staleShare is non-null', () => {
    render(<DraftReelPreview />);
    act(() => { useReelPreviewStore.getState().open({ ...snapshot, staleShare }); });

    expect(screen.getByRole('button', { name: /update shared version/i })).toBeTruthy();
  });

  it('hides the affordance when payload.staleShare is null', () => {
    render(<DraftReelPreview />);
    act(() => { useReelPreviewStore.getState().open({ ...snapshot, staleShare: null }); });

    expect(screen.queryByRole('button', { name: /update shared version/i })).toBeNull();
  });

  it('fires ZERO network/fetch calls on mount when staleShare is present (Invariant 1: no reactive fetch)', () => {
    render(<DraftReelPreview />);
    act(() => { useReelPreviewStore.getState().open({ ...snapshot, staleShare }); });

    // Staleness rides the already-fetched project row; mounting the preview
    // (even with a non-null staleShare) must not itself trigger apiFetch.
    expect(apiFetchMock).not.toHaveBeenCalled();
    expect(repointShareLinkMock).not.toHaveBeenCalled();
  });

  it('clicking "Update shared version" calls repointShareLink with the stale token, shows the "updated" confirmation for a real change, and hides the affordance on success', async () => {
    render(<DraftReelPreview />);
    act(() => { useReelPreviewStore.getState().open({ ...snapshot, staleShare }); });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /update shared version/i }));
    });

    expect(repointShareLinkMock).toHaveBeenCalledWith(
      expect.objectContaining({ downloadId: snapshot.finalVideoId, shareToken: staleShare.share_token }),
    );
    expect(toastSuccessMock).toHaveBeenCalledWith('Shared version updated', expect.anything());
    expect(screen.queryByRole('button', { name: /update shared version/i })).toBeNull();
  });

  it('refreshes the projects store on a successful repoint, so closing and reopening the SAME tile does not resurrect the stale affordance', async () => {
    // Round-8 reviewer finding: the success branch used to only clear local
    // state (setStaleShare(null)), leaving the projects STORE's cached row
    // stale. Reopening the same DraftTile before any unrelated refetch read
    // that stale cached row and the affordance reappeared even though the
    // share was already current. Mirrors the 409 video_not_current branch,
    // which already force-refetches.
    fetchProjectsMock.mockResolvedValueOnce([
      { id: snapshot.projectId, stale_share: null },
    ]);

    render(<DraftReelPreview />);
    act(() => { useReelPreviewStore.getState().open({ ...snapshot, staleShare }); });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /update shared version/i }));
    });

    expect(fetchProjectsMock).toHaveBeenCalledWith({ force: true });

    // Simulate the close -> reopen from the SAME DraftTile: the tile now
    // renders from the store's REFRESHED row (stale_share: null, per the
    // mock above) rather than the pre-repoint snapshot.
    act(() => useReelPreviewStore.getState().close());
    const refreshedProjects = await fetchProjectsMock.mock.results[0].value;
    const refreshedProject = refreshedProjects.find((p) => p.id === snapshot.projectId);
    act(() => {
      useReelPreviewStore.getState().open({ ...snapshot, staleShare: refreshedProject.stale_share });
    });

    expect(screen.queryByRole('button', { name: /update shared version/i })).toBeNull();
  });

  it('shows the "up to date" confirmation (not "updated") on the idempotent no-op, per design §5', async () => {
    repointShareLinkMock.mockResolvedValueOnce({
      shareUrl: 'https://reelballers.com/shared/stale-tok-1', changed: false,
    });

    render(<DraftReelPreview />);
    act(() => { useReelPreviewStore.getState().open({ ...snapshot, staleShare }); });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /update shared version/i }));
    });

    expect(toastSuccessMock).toHaveBeenCalledWith('Shared version is up to date', expect.anything());
    expect(screen.queryByRole('button', { name: /update shared version/i })).toBeNull();
  });

  // design §5: these refusals leave the affordance visible (still stale,
  // retry is available) and show their exact mapped copy -- no fallthrough
  // to the raw backend `detail` text.
  it.each([
    ['target_missing', undefined, /isn.t ready yet|try again shortly/i],
    ['repoint_conflict', undefined, /changed.*refresh|refresh.*retry/i],
    ['share_project_mismatch', undefined, /does not belong to this project/i],
    [undefined, 404, /no longer exists/i],
    [undefined, 403, /only the sharer/i],
    [undefined, 400, /can.t be updated this way/i],
  ])('maps code=%s/status=%s to the corresponding toast and keeps the affordance visible', async (code, status, expectedMessage) => {
    const err = new Error('raw backend detail text, should not appear verbatim');
    err.code = code;
    err.status = status;
    repointShareLinkMock.mockRejectedValueOnce(err);

    render(<DraftReelPreview />);
    act(() => { useReelPreviewStore.getState().open({ ...snapshot, staleShare }); });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /update shared version/i }));
    });

    expect(toastErrorMock).toHaveBeenCalled();
    const [, options] = toastErrorMock.mock.calls[toastErrorMock.mock.calls.length - 1];
    expect(options?.message ?? '').toMatch(expectedMessage);
    expect(screen.getByRole('button', { name: /update shared version/i })).toBeTruthy();
  });

  it('HIDES the affordance on a 410 (revoked) response, per design §5 -- retrying a dead token can never succeed', async () => {
    const err = new Error('This share has been revoked');
    err.status = 410;
    repointShareLinkMock.mockRejectedValueOnce(err);

    render(<DraftReelPreview />);
    act(() => { useReelPreviewStore.getState().open({ ...snapshot, staleShare }); });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /update shared version/i }));
    });

    expect(toastErrorMock).toHaveBeenCalled();
    const [, options] = toastErrorMock.mock.calls[toastErrorMock.mock.calls.length - 1];
    expect(options?.message ?? '').toMatch(/revoked/i);
    expect(screen.queryByRole('button', { name: /update shared version/i })).toBeNull();
  });

  describe('409 video_not_current -- re-reads staleness per design §5', () => {
    it('refetches the projects list and keeps the affordance visible with the REFRESHED stale token when still stale', async () => {
      const err = new Error('video_not_current');
      err.code = 'video_not_current';
      repointShareLinkMock.mockRejectedValueOnce(err);
      const freshStaleShare = { share_token: 'fresh-tok-2', old_filename: 'v2.mp4' };
      fetchProjectsMock.mockResolvedValueOnce([
        { id: snapshot.projectId, stale_share: freshStaleShare },
      ]);

      render(<DraftReelPreview />);
      act(() => { useReelPreviewStore.getState().open({ ...snapshot, staleShare }); });

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /update shared version/i }));
      });

      expect(fetchProjectsMock).toHaveBeenCalledWith({ force: true });
      expect(toastErrorMock).toHaveBeenCalled();
      const [, options] = toastErrorMock.mock.calls[toastErrorMock.mock.calls.length - 1];
      expect(options?.message ?? '').toMatch(/reopen it and try/i);
      expect(screen.getByRole('button', { name: /update shared version/i })).toBeTruthy();

      // A follow-up click must use the FRESH token from the refetch, not the
      // original (now-superseded) staleShare.share_token.
      repointShareLinkMock.mockResolvedValueOnce({ shareUrl: 'x', changed: true });
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /update shared version/i }));
      });
      expect(repointShareLinkMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ shareToken: 'fresh-tok-2' }),
      );
    });

    it('hides the affordance when the refetch shows the project is no longer stale', async () => {
      const err = new Error('video_not_current');
      err.code = 'video_not_current';
      repointShareLinkMock.mockRejectedValueOnce(err);
      fetchProjectsMock.mockResolvedValueOnce([
        { id: snapshot.projectId, stale_share: null },
      ]);

      render(<DraftReelPreview />);
      act(() => { useReelPreviewStore.getState().open({ ...snapshot, staleShare }); });

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /update shared version/i }));
      });

      expect(fetchProjectsMock).toHaveBeenCalledWith({ force: true });
      expect(screen.queryByRole('button', { name: /update shared version/i })).toBeNull();
    });
  });
});
