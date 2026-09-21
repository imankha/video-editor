import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// T10180: DraftReelPreview is being rewired from the two-flag (published/failed)
// publish->share model to a `phase` state machine (idle/review/publishing/ready/
// failed) with a visibility-review confirm step and a distinct link-ready state
// that shows the share URL BEFORE any copy. See docs/plans/tasks/T10180-design.md.
//
// apiFetch + store fns for the publish path (usePublishProject).
const { apiFetchMock, fetchProjectsMock, toastSuccessMock, toastErrorMock, createShareLinkMock, webShareMock } = vi.hoisted(() => ({
  apiFetchMock: vi.fn(),
  fetchProjectsMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
  createShareLinkMock: vi.fn(),
  webShareMock: vi.fn(),
}));

vi.mock('../utils/apiFetch', () => ({ default: (...a) => apiFetchMock(...a) }));
vi.mock('../stores/projectsStore', () => {
  const state = { fetchProjects: fetchProjectsMock };
  const useProjectsStore = (sel) => sel(state);
  useProjectsStore.getState = () => state;
  return { useProjectsStore };
});
vi.mock('../stores/galleryStore', () => {
  const api = { fetchCount: vi.fn(), notifyCollectionsChanged: vi.fn(), open: vi.fn() };
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
vi.mock('../hooks/useWebShare', () => ({
  useWebShare: () => ({
    copyLink: vi.fn().mockResolvedValue('clipboard'),
    webShare: webShareMock,
    createShareLink: createShareLinkMock,
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
const { setPendingGameMock } = vi.hoisted(() => ({ setPendingGameMock: vi.fn() }));
vi.mock('../utils/pendingNavigation', () => ({
  setPendingGame: (...a) => setPendingGameMock(...a),
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

  // Test 1: idle shows "Publish and get link", cyan banner, no review card.
  it('idle phase shows "Publish and get link", the cyan draft banner, and no review card', () => {
    render(<DraftReelPreview />);
    openPreview();

    expect(screen.getByTestId('draft-preview-banner').textContent)
      .toMatch(/only you can see this/i);
    expect(screen.getByRole('button', { name: 'Publish and get link' })).toBeTruthy();
    // No review-card affordances yet.
    expect(screen.queryByText(/anyone with the link can watch/i)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Publish and create link' })).toBeNull();
  });

  // Test 2: click "Publish and get link" -> review card renders, no publish call fired.
  it('clicking "Publish and get link" opens the review card without publishing yet', () => {
    render(<DraftReelPreview />);
    openPreview();

    fireEvent.click(screen.getByRole('button', { name: 'Publish and get link' }));

    expect(screen.getByText('Publish "Brilliant Dribble"?')).toBeTruthy();
    expect(screen.getByText(/anyone with the link can watch/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Publish and create link' })).toBeTruthy();
    // No write yet: publish (apiFetch) must not have been called.
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  // Test 3: Cancel returns to idle, no write, no link created.
  it('Cancel on the review card returns to idle with no write and no link', () => {
    render(<DraftReelPreview />);
    openPreview();
    fireEvent.click(screen.getByRole('button', { name: 'Publish and get link' }));

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    // Back to idle: primary CTA re-appears, review card gone.
    expect(screen.getByRole('button', { name: 'Publish and get link' })).toBeTruthy();
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
    fireEvent.click(screen.getByRole('button', { name: 'Publish and get link' }));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Publish and create link' }));
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
    fireEvent.click(screen.getByRole('button', { name: 'Publish and get link' }));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Publish and create link' }));
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
    expect(screen.queryByRole('button', { name: 'Publish and get link' })).toBeNull();
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
