// T13670: the story player's Share button must open ShareModal, never mint a
// public link in one tap.
// (T13120 header follows) a phone (coarse pointer) Share must NOT mint a public link in one
// tap. It opens the ShareModal (visibility choice, default "Only people I
// add") exactly like desktop.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';

vi.mock('../utils/apiFetch', () => ({
  default: (...args) => globalThis.apiFetchImpl(...args),
}));

const captured = vi.hoisted(() => ({ onPlayCollection: null, playerOnShare: null }));

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
    captured.onPlayCollection = props.onPlayCollection;
    return <div data-testid="collections-tab" />;
  },
}));
vi.mock('./ranking/ConfidenceBanner', () => ({ ConfidenceBanner: () => null }));
vi.mock('./ranking/RankingGame', () => ({ RankingGame: () => null }));
vi.mock('./introcards/IntroStoryPlayer', () => ({ IntroStoryPlayer: (props) => { captured.playerOnShare = props.onShare; return <div data-testid="story-player" />; } }));
vi.mock('./ShareModal', () => ({
  ShareModal: ({ videoId }) => <div data-testid="share-modal">{videoId}</div>,
}));

import { PublishedReelsPanel } from './PublishedReelsPanel';
import { useProfileStore } from '../stores/profileStore';

describe('PublishedReelsPanel player Share (T13670)', () => {
  const originalMatchMedia = window.matchMedia;
  const originalClipboard = navigator.clipboard;

  beforeEach(() => {
    useProfileStore.setState({ profiles: [{ id: 'p1', isCurrent: true }], currentProfileId: 'p1' });
    window.matchMedia = vi.fn((q) => ({
      matches: false, media: q,
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(),
    }));
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockResolvedValue() }, configurable: true });
    globalThis.apiFetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ shares: [{ share_token: 'tok' }] }),
    }));
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    Object.defineProperty(navigator, 'clipboard', { value: originalClipboard, configurable: true });
    cleanup();
  });

  it('T13670:C1 player Share opens the visibility modal and creates no share', async () => {
    render(<PublishedReelsPanel active onOpenProject={() => {}} />);
    await screen.findByTestId('collections-tab');
    await act(async () => {
      await captured.onPlayCollection([{ id: 42, name: 'Reel' }], 'Reel', null);
    });
    await screen.findByTestId('story-player');

    await act(async () => { await captured.playerOnShare({ id: 42, name: 'Reel' }); });

    const sharePosts = globalThis.apiFetchImpl.mock.calls.filter(
      ([url, opts]) => String(url).includes('/share') && opts?.method === 'POST',
    );
    expect(sharePosts).toHaveLength(0);
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
    expect((await screen.findByTestId('share-modal')).textContent).toBe('42');
  });
});
