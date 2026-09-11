import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
import { useQuestStore } from '../stores/questStore';
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

  it('T8390: alreadyPublished payload opens straight into the published (Share) state, no draft banner', () => {
    render(<DraftReelPreview />);
    act(() => { useReelPreviewStore.getState().open({ ...snapshot, alreadyPublished: true }); });

    // No "landing on another decision screen": Publish never appears, Share does.
    expect(screen.queryByTitle('Publish to Highlight Reels')).toBeNull();
    expect(screen.getByTitle('Share')).toBeTruthy();
    expect(screen.queryByTestId('draft-preview-banner')).toBeNull();
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

  // T8535: the quest_4 "Watch Your Preview" timer moved here from DraftTile so it
  // still fires from the consolidated draft-preview surface (T6840 behavior).
  describe('T6840/T8535 preview-watched achievement', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      useQuestStore.getState().recordAchievement.mockClear();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('records previewed_draft_reel_1s after ~1s of playback, not on open', () => {
      render(<DraftReelPreview />);
      openPreview();
      expect(useQuestStore.getState().recordAchievement).not.toHaveBeenCalledWith('previewed_draft_reel_1s');
      act(() => vi.advanceTimersByTime(1000));
      expect(useQuestStore.getState().recordAchievement).toHaveBeenCalledWith('previewed_draft_reel_1s');
    });

    it('does NOT record it if the preview is closed before ~1s', () => {
      render(<DraftReelPreview />);
      openPreview();
      act(() => vi.advanceTimersByTime(500));
      act(() => { useReelPreviewStore.getState().close(); });
      act(() => vi.advanceTimersByTime(1000));
      expect(useQuestStore.getState().recordAchievement).not.toHaveBeenCalledWith('previewed_draft_reel_1s');
    });
  });
});

// T9470: the reported bug was "Preview does nothing, then a dialog opens over a
// DIFFERENT screen." Root cause (code_expert): openFinishedReel navigates HOME
// first, but the preview was mounted only in the editor return, so a click on
// the drafts (home) screen set the snapshot with no consumer, and the overlay
// then surfaced late over whatever editor screen the user opened next. The fix
// mounts DraftReelPreview on home too AND scopes the snapshot to the screen it
// opened on (openMode) so a late arrival on another screen is discarded, never
// rendered. These tests drive the REAL editorStore so the openMode-vs-editorMode
// scoping is exercised end to end, not stubbed.
const scopedSnapshot = { ...snapshot, openMode: EDITOR_MODES.PROJECT_MANAGER };
const openScoped = () => act(() => { useReelPreviewStore.getState().open(scopedSnapshot); });

describe('DraftReelPreview (T9470 open-on-click + navigate-away scoping)', () => {
  beforeEach(() => {
    mountSpy.mockReset();
    act(() => useReelPreviewStore.getState().close());
    // The preview opens on the drafts/home screen (openFinishedReel navigates
    // there first). Reset to it so each test starts on the opening screen.
    act(() => useEditorStore.setState({ editorMode: EDITOR_MODES.PROJECT_MANAGER }));
  });
  afterEach(() => {
    // Don't leak a navigated-away editorMode into the other suites' tests.
    act(() => useEditorStore.setState({ editorMode: EDITOR_MODES.PROJECT_MANAGER }));
  });

  // 1) The click has an IMMEDIATE visible consequence: the player shell renders
  //    synchronously on open (the "does nothing" half of the bug).
  it('opens the player shell immediately on the screen it was opened on', () => {
    act(() => useEditorStore.setState({ editorMode: EDITOR_MODES.PROJECT_MANAGER }));
    render(<DraftReelPreview />);
    openScoped();
    expect(screen.getByTestId('mock-player')).toBeTruthy();
  });

  // 2) A second click on the same draft rebuilds an equivalent snapshot with the
  //    same finalVideoId, so the keyed inner is NOT remounted and the video
  //    (its stream request) is not re-created: no duplicate dialog/request.
  it('a repeat open of the same draft does not remount the player (no duplicate request)', () => {
    render(<DraftReelPreview />);
    openScoped();
    expect(mountSpy).toHaveBeenCalledTimes(1);
    openScoped();
    expect(mountSpy).toHaveBeenCalledTimes(1);
  });

  // 3) THE SUBSTANTIVE ONE: navigating to another screen while the preview is
  //    still up must discard the snapshot, never render the player over that
  //    unrelated screen. An immediate shell alone would hide this bug.
  it('discards the snapshot when the user navigates away, never rendering over another screen', () => {
    render(<DraftReelPreview />);
    openScoped();
    expect(screen.getByTestId('mock-player')).toBeTruthy();

    // User leaves the drafts screen for an editor screen before it finished.
    act(() => useEditorStore.setState({ editorMode: EDITOR_MODES.ANNOTATE }));

    // The player is gone (not rendered over Annotate) AND the orphaned snapshot
    // is cleared from the store so it can never re-surface on a later screen.
    expect(screen.queryByTestId('mock-player')).toBeNull();
    expect(useReelPreviewStore.getState().payload).toBeNull();
  });

  // A payload with no openMode (legacy/dev direct-open) must NOT be treated as
  // off-page — it renders wherever it is opened, unchanged from pre-T9470.
  it('a payload without openMode is never treated as off-page', () => {
    act(() => useEditorStore.setState({ editorMode: EDITOR_MODES.ANNOTATE }));
    render(<DraftReelPreview />);
    openPreview(); // snapshot has no openMode
    expect(screen.getByTestId('mock-player')).toBeTruthy();
  });
});
