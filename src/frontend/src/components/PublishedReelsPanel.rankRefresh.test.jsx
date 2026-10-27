// T13630:C2 the Ranking Progress banner refetches after a move and after a profile
// switch, so its counts follow the highlights instead of the previous state.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';

const hoisted = vi.hoisted(() => ({ keys: [], onMoved: null }));

vi.mock('../utils/apiFetch', () => ({ default: (...a) => globalThis.apiFetchImpl(...a) }));
vi.mock('../hooks/useDownloads', () => ({
  useDownloads: () => ({
    downloads: [], deleteDownload: vi.fn(), downloadFile: vi.fn(), downloadingId: null,
    renameDownload: vi.fn(), setIntroCard: vi.fn(), pruneDanglingIntroCards: vi.fn(),
    markWatched: vi.fn(), formatDate: () => '',
  }),
}));
vi.mock('../hooks/useCollections', () => ({
  useCollections: () => ({
    summary: null, summaryState: 'ready', members: {}, memberStates: {},
    fetchSummary: vi.fn(), fetchMembers: vi.fn(), removeMember: vi.fn(),
    patchMember: vi.fn(), resortMembers: vi.fn(), pruneDanglingIntroCards: vi.fn(),
  }),
}));
vi.mock('../hooks/useMoveReels', () => ({
  useMoveReels: (onMoved) => {
    hoisted.onMoved = onMoved;
    return { moveReels: vi.fn(), moving: false };
  },
}));
vi.mock('./collections/CollectionsTab', () => ({ CollectionsTab: () => <div /> }));
vi.mock('./ranking/ConfidenceBanner', () => ({
  ConfidenceBanner: ({ refreshKey }) => { hoisted.keys.push(refreshKey); return null; },
}));
vi.mock('./ranking/RankingGame', () => ({ RankingGame: () => null }));
vi.mock('./introcards/IntroStoryPlayer', () => ({ IntroStoryPlayer: () => null }));

import { PublishedReelsPanel } from './PublishedReelsPanel';
import { useProfileStore } from '../stores/profileStore';

const last = () => hoisted.keys[hoisted.keys.length - 1];

describe('PublishedReelsPanel ranking banner refresh (T13630)', () => {
  beforeEach(() => {
    hoisted.keys = [];
    useProfileStore.setState({
      profiles: [{ id: 'p1', isCurrent: true }, { id: 'p2' }], currentProfileId: 'p1',
    });
    globalThis.apiFetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
  });
  afterEach(cleanup);

  it('T13630:C2 a completed move changes the banner refreshKey', async () => {
    await act(async () => { render(<PublishedReelsPanel active onOpenProject={() => {}} />); });
    const before = last();
    await act(async () => { hoisted.onMoved([8]); });
    expect(last()).not.toEqual(before);
  });

  it('T13630:C2 a profile switch changes the banner refreshKey', async () => {
    await act(async () => { render(<PublishedReelsPanel active onOpenProject={() => {}} />); });
    const before = last();
    await act(async () => { useProfileStore.setState({ currentProfileId: 'p2' }); });
    expect(last()).not.toEqual(before);
  });
});
