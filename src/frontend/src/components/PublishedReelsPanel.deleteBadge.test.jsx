// T13860: deleting a highlight applies a local delta to galleryStore (count,
// unwatchedCount) from the delete gesture -- no refetch of the count.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react';

const DOWNLOAD = vi.hoisted(() => ({ id: 8, project_name: 'Play 1', filename: 'final_9_b251cb00.mp4' }));
const hoisted = vi.hoisted(() => ({
  onDelete: null,
  deleteDownload: vi.fn(),
  removeMember: vi.fn(),
}));

vi.mock('../utils/apiFetch', () => ({
  default: (...args) => globalThis.apiFetchImpl(...args),
}));

vi.mock('../hooks/useDownloads', () => ({
  useDownloads: () => ({
    downloads: [],
    deleteDownload: hoisted.deleteDownload,
    downloadFile: vi.fn(),
    downloadingId: null,
    renameDownload: vi.fn(),
    setIntroCard: vi.fn(),
    pruneDanglingIntroCards: vi.fn(),
    markWatched: vi.fn(),
    formatDate: () => '',
  }),
}));

vi.mock('../hooks/useCollections', () => ({
  useCollections: () => ({
    summary: null, summaryState: 'ready', members: {}, memberStates: {},
    fetchSummary: vi.fn(), fetchMembers: vi.fn(), removeMember: hoisted.removeMember,
    patchMember: vi.fn(), resortMembers: vi.fn(), pruneDanglingIntroCards: vi.fn(),
  }),
}));

vi.mock('./collections/CollectionsTab', () => ({
  CollectionsTab: (props) => {
    hoisted.onDelete = props.renderCard(DOWNLOAD).props.onDelete;
    return <div data-testid="collections-tab" />;
  },
}));
vi.mock('./ranking/ConfidenceBanner', () => ({ ConfidenceBanner: () => null }));
vi.mock('./ranking/RankingGame', () => ({ RankingGame: () => null }));
vi.mock('./introcards/IntroStoryPlayer', () => ({ IntroStoryPlayer: () => null }));

import { PublishedReelsPanel } from './PublishedReelsPanel';


const inAct = (fn) => act(async () => { await fn(); });

import { useProfileStore } from '../stores/profileStore';
import { useGalleryStore } from '../stores/galleryStore';

describe('PublishedReelsPanel delete -> galleryStore delta (T13860)', () => {
  beforeEach(() => {
    hoisted.deleteDownload.mockReset();
    useProfileStore.setState({ profiles: [{ id: 'p1', isCurrent: true }], currentProfileId: 'p1' });
    useGalleryStore.getState().setFromBootstrap({ count: 3, unwatched_count: 2 });
    globalThis.apiFetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
  });
  afterEach(() => cleanup());

  async function deleteIt(ok) {
    hoisted.deleteDownload.mockResolvedValue(ok);
    render(<PublishedReelsPanel active onOpenProject={() => {}} />);
    await waitFor(() => expect(hoisted.onDelete).toBeTruthy());
    await inAct(() => hoisted.onDelete({ stopPropagation: () => {} }, DOWNLOAD));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(hoisted.deleteDownload).toHaveBeenCalled());
  }

  it('T13860:C1 deleting an unwatched highlight decrements count and unwatchedCount without a count fetch', async () => {
    await deleteIt(true);
    await waitFor(() => expect(useGalleryStore.getState().count).toBe(2));
    expect(useGalleryStore.getState().unwatchedCount).toBe(1);
    const urls = globalThis.apiFetchImpl.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes('/api/downloads/count'))).toBe(false);
  });

  it('T13860:C1 deleting a watched highlight leaves unwatchedCount alone', async () => {
    DOWNLOAD.watched_at = '2026-10-01T00:00:00Z';
    try {
      await deleteIt(true);
      await waitFor(() => expect(useGalleryStore.getState().count).toBe(2));
      expect(useGalleryStore.getState().unwatchedCount).toBe(2);
    } finally { delete DOWNLOAD.watched_at; }
  });

  it('T13860:C1 a failed delete leaves the counts untouched', async () => {
    await deleteIt(false);
    expect(useGalleryStore.getState().count).toBe(3);
    expect(useGalleryStore.getState().unwatchedCount).toBe(2);
  });
});
