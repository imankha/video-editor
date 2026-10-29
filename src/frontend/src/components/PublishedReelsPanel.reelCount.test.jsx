// T13850: delete / move of a highlight decrement its game card's reel_count
// locally (change event), no /api/games refetch.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react';

const DOWNLOAD = vi.hoisted(() => ({ id: 8, project_name: 'Play 1', filename: 'final_9_b251cb00.mp4', game_ids: [4] }));
const hoisted = vi.hoisted(() => ({ onDelete: null, deleteDownload: vi.fn() }));

vi.mock('../utils/apiFetch', () => ({ default: (...a) => globalThis.apiFetchImpl(...a) }));
vi.mock('../hooks/useDownloads', () => ({
  useDownloads: () => ({
    downloads: [], deleteDownload: hoisted.deleteDownload, downloadFile: vi.fn(), downloadingId: null,
    renameDownload: vi.fn(), setIntroCard: vi.fn(), pruneDanglingIntroCards: vi.fn(), markWatched: vi.fn(), formatDate: () => '',
  }),
}));
vi.mock('../hooks/useCollections', () => ({
  useCollections: () => ({
    summary: null, summaryState: 'ready', members: {}, memberStates: {},
    fetchSummary: vi.fn(), fetchMembers: vi.fn(), removeMember: vi.fn(),
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
import { useProfileStore } from '../stores/profileStore';
import { useGalleryStore } from '../stores/galleryStore';
import { useGamesDataStore } from '../stores/gamesDataStore';

describe('PublishedReelsPanel delete -> game card reel_count (T13850)', () => {
  beforeEach(() => {
    hoisted.deleteDownload.mockReset();
    useProfileStore.setState({ profiles: [{ id: 'p1', isCurrent: true }], currentProfileId: 'p1' });
    useGalleryStore.getState().setFromBootstrap({ count: 3, unwatched_count: 2 });
    useGamesDataStore.setState({ games: [{ id: 4, status: 'ready', reel_count: 2 }], readyGames: [{ id: 4, status: 'ready', reel_count: 2 }] });
    globalThis.apiFetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
  });
  afterEach(() => cleanup());

  async function deleteIt(ok) {
    hoisted.deleteDownload.mockResolvedValue(ok);
    render(<PublishedReelsPanel active onOpenProject={() => {}} />);
    await waitFor(() => expect(hoisted.onDelete).toBeTruthy());
    await act(async () => { await hoisted.onDelete({ stopPropagation: () => {} }, DOWNLOAD); });
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(hoisted.deleteDownload).toHaveBeenCalled());
  }

  it('T13850:C1 delete decrements the game reel_count, no games fetch', async () => {
    await deleteIt(true);
    await waitFor(() => expect(useGamesDataStore.getState().games[0].reel_count).toBe(1));
    expect(globalThis.apiFetchImpl.mock.calls.some((c) => String(c[0]).includes('/api/games'))).toBe(false);
  });

  it('T13850:C1 a failed delete leaves reel_count alone', async () => {
    await deleteIt(false);
    expect(useGamesDataStore.getState().games[0].reel_count).toBe(2);
  });
});
