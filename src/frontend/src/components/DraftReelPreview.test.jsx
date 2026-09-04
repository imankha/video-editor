import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// apiFetch + store fns for the publish path (usePublishProject).
const { apiFetchMock, fetchProjectsMock, toastSuccessMock, toastErrorMock } = vi.hoisted(() => ({
  apiFetchMock: vi.fn(),
  fetchProjectsMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
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
vi.mock('../hooks/useWebShare', () => ({
  useWebShare: () => ({ copyLink: vi.fn().mockResolvedValue('clipboard'), webShare: vi.fn(), isMobile: false }),
}));

// Mock CollectionPlayer down to a harness that surfaces the props DraftReelPreview
// drives: it records the streamUrl (identity check), renders the statusBanner, and
// exposes Publish/Share by their titles. A mount counter proves the player is NOT
// remounted on publish (§4.7: same final_video_id, video does not reload).
const { mountSpy } = vi.hoisted(() => ({ mountSpy: vi.fn() }));
vi.mock('./collections/CollectionPlayer', async () => {
  const { useEffect } = await import('react');
  return {
    CollectionPlayer: ({ reels, statusBanner, onPublish, onShare, publishLoading, onClose }) => {
    // Fire only when the video identity (streamUrl) changes — that is what a real
    // <video> reload keys on. A publish that keeps the same final_video_id must
    // NOT change it, so this must stay at one call across publish (§4.7).
    const streamUrl = reels[0].streamUrl;
    useEffect(() => { mountSpy(streamUrl); }, [streamUrl]);
    return (
      <div data-testid="mock-player">
        <span data-testid="stream-url">{reels[0].streamUrl}</span>
        {statusBanner}
        {onPublish && (
          <button title="Publish to Highlight Reels" disabled={publishLoading} onClick={onPublish}>Publish</button>
        )}
        {onShare && <button title="Share" onClick={() => onShare(reels[0])}>Share</button>}
        <button title="Close" onClick={onClose}>Close</button>
      </div>
    );
    },
  };
});

import { DraftReelPreview } from './DraftReelPreview';
import { useReelPreviewStore } from '../stores/reelPreviewStore';

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

describe('DraftReelPreview (T8530)', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    fetchProjectsMock.mockReset();
    toastSuccessMock.mockReset();
    toastErrorMock.mockReset();
    mountSpy.mockReset();
    act(() => useReelPreviewStore.getState().close());
  });

  it('renders nothing when no payload is open', () => {
    render(<DraftReelPreview />);
    expect(screen.queryByTestId('mock-player')).toBeNull();
  });

  it('draft state shows the cyan draft banner and a Publish button', () => {
    render(<DraftReelPreview />);
    openPreview();
    expect(screen.getByTestId('draft-preview-banner').textContent)
      .toMatch(/only you can see this/i);
    expect(screen.getByTitle('Publish to Highlight Reels')).toBeTruthy();
    expect(screen.queryByTitle('Share')).toBeNull();
  });

  it('publish success swaps Publish->Share, drops the banner, and does NOT reload the video', async () => {
    apiFetchMock.mockResolvedValueOnce(jsonResponse(200, { archived: true, final_video_id: 99 }));
    render(<DraftReelPreview />);
    openPreview();

    const urlBefore = screen.getByTestId('stream-url').textContent;
    expect(mountSpy).toHaveBeenCalledTimes(1);

    await act(async () => { fireEvent.click(screen.getByTitle('Publish to Highlight Reels')); });

    // Slot swap: Publish gone, Share present.
    await waitFor(() => expect(screen.queryByTitle('Publish to Highlight Reels')).toBeNull());
    expect(screen.getByTitle('Share')).toBeTruthy();
    // Banner unmounts once published.
    expect(screen.queryByTestId('draft-preview-banner')).toBeNull();
    // Success toast.
    expect(toastSuccessMock).toHaveBeenCalledWith('Published', { message: 'Anyone with the link can watch it.' });
    // §4.7 coherence: SAME final_video_id / same stream URL, player NOT remounted.
    expect(screen.getByTestId('stream-url').textContent).toBe(urlBefore);
    expect(mountSpy).toHaveBeenCalledTimes(1);
  });

  it('503 sync_failed shows the amber retry banner (copy matches DraftTile.jsx:849)', async () => {
    apiFetchMock.mockResolvedValueOnce(
      jsonResponse(503, { code: 'sync_failed', retryable: true })
    );
    render(<DraftReelPreview />);
    openPreview();

    await act(async () => { fireEvent.click(screen.getByTitle('Publish to Highlight Reels')); });

    const banner = await screen.findByTestId('draft-preview-banner');
    expect(banner.textContent).toMatch(/couldn't save to the cloud\./i);
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    // Still a draft (not published): Share must not have appeared.
    expect(screen.queryByTitle('Share')).toBeNull();
  });
});
