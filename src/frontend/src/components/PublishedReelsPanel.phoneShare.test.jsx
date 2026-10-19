// T13120: a phone (coarse pointer) Share must NOT mint a public link in one
// tap. It opens the ShareModal (visibility choice, default "Only people I
// add") exactly like desktop.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

vi.mock('../utils/apiFetch', () => ({
  default: (...args) => globalThis.apiFetchImpl(...args),
}));

const captured = vi.hoisted(() => ({ onShareReel: null }));

vi.mock('../hooks/useDownloads', () => ({
  useDownloads: () => ({
    downloads: [],
    deleteDownload: vi.fn(),
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
    fetchSummary: vi.fn(), fetchMembers: vi.fn(), removeMember: vi.fn(),
    patchMember: vi.fn(), resortMembers: vi.fn(), pruneDanglingIntroCards: vi.fn(),
  }),
}));

vi.mock('./collections/CollectionsTab', () => ({
  CollectionsTab: (props) => {
    captured.onShareReel = props.onShareReel;
    return <div data-testid="collections-tab" />;
  },
}));
vi.mock('./ranking/ConfidenceBanner', () => ({ ConfidenceBanner: () => null }));
vi.mock('./ranking/RankingGame', () => ({ RankingGame: () => null }));
vi.mock('./introcards/IntroStoryPlayer', () => ({ IntroStoryPlayer: () => null }));
vi.mock('./ShareModal', () => ({
  ShareModal: ({ videoId }) => <div data-testid="share-modal">{videoId}</div>,
}));

import { PublishedReelsPanel } from './PublishedReelsPanel';
import { useProfileStore } from '../stores/profileStore';

describe('PublishedReelsPanel phone Share (T13120)', () => {
  const originalMatchMedia = window.matchMedia;
  const originalShare = navigator.share;

  beforeEach(() => {
    useProfileStore.setState({ profiles: [{ id: 'p1', isCurrent: true }], currentProfileId: 'p1' });
    window.matchMedia = vi.fn((q) => ({
      matches: q.includes('pointer: coarse'),
      media: q,
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(),
    }));
    navigator.share = vi.fn().mockResolvedValue();
    globalThis.apiFetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ shares: [{ share_token: 'tok' }] }),
    }));
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    navigator.share = originalShare;
    cleanup();
  });

  it('T13120:C1 phone Share opens the visibility modal and creates no public share', async () => {
    render(<PublishedReelsPanel active onOpenProject={() => {}} />);
    await screen.findByTestId('collections-tab');

    await captured.onShareReel({ stopPropagation: () => {} }, { id: 42, project_name: 'Reel' });

    const publicPosts = globalThis.apiFetchImpl.mock.calls.filter(
      ([url, opts]) => String(url).includes('/share') && opts?.method === 'POST'
        && JSON.parse(opts.body).is_public === true,
    );
    expect(publicPosts).toHaveLength(0);
    expect(navigator.share).not.toHaveBeenCalled();
    expect((await screen.findByTestId('share-modal')).textContent).toBe('42');
  });
});
