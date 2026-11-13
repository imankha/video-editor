// T11510:C7 (restated by the owner ruling 2026-11-13: the share chooser is
// superseded by T13120). On a coarse pointer, the three published-highlight
// Share entries -- the player Share, the tile's card-face Share and the tile's
// mobile kebab Share -- each open T13120's ShareModal with "Only people I add"
// selected, and none of them sends the video file (no navigator.share, no
// file fetch) or creates a public link.
//
// The real ReelTile and the real ShareModal render; only the network
// (apiFetch), the Web Share API (external) and the heavy video player shell
// are stubbed. The player stub renders the Share button CollectionPlayer
// renders (onClick={() => onShare(activeReel)}).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within, waitFor } from '@testing-library/react';

vi.mock('../utils/apiFetch', () => ({
  default: (...args) => globalThis.apiFetchImpl(...args),
}));

const DOWNLOAD = vi.hoisted(() => ({
  id: 42, project_name: 'Goal vs Sharks', created_at: '2026-11-01T00:00:00Z',
  duration: 12, file_url: 'https://r2.example/42.mp4', aspect_ratio: '9:16',
}));

vi.mock('../hooks/useDownloads', () => ({
  useDownloads: () => ({
    downloads: [DOWNLOAD],
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

// The tab renders the panel's own tile renderer (the real ReelTile + handlers).
vi.mock('./collections/CollectionsTab', () => ({
  CollectionsTab: (props) => <div data-testid="collections-tab">{props.renderCard(DOWNLOAD)}</div>,
}));
vi.mock('./ranking/ConfidenceBanner', () => ({ ConfidenceBanner: () => null }));
vi.mock('./ranking/RankingGame', () => ({ RankingGame: () => null }));
vi.mock('./introcards/IntroStoryPlayer', () => ({
  IntroStoryPlayer: ({ reels, onShare }) => (
    <div data-testid="story-player">
      <button type="button" onClick={() => onShare(reels[0])}>Player Share</button>
    </div>
  ),
}));

import { PublishedReelsPanel } from './PublishedReelsPanel';
import { useProfileStore } from '../stores/profileStore';

describe('T11510:C7 published highlight Share on a coarse pointer opens ShareModal', () => {
  const originalMatchMedia = window.matchMedia;
  const originalShare = navigator.share;
  const originalCanShare = navigator.canShare;

  beforeEach(() => {
    useProfileStore.setState({ profiles: [{ id: 'p1', isCurrent: true }], currentProfileId: 'p1' });
    window.matchMedia = vi.fn((q) => ({
      matches: q.includes('pointer: coarse'),
      media: q,
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(),
    }));
    // A phone that CAN share files: the test proves no entry uses it.
    navigator.share = vi.fn().mockResolvedValue();
    navigator.canShare = vi.fn(() => true);
    globalThis.apiFetchImpl = vi.fn(async (url) => ({
      ok: true,
      json: async () => {
        const u = String(url);
        if (u.includes('/contacts')) return { contacts: [] };
        if (u.endsWith('/shares')) return [];
        return { intro: null };
      },
    }));
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    navigator.share = originalShare;
    navigator.canShare = originalCanShare;
    cleanup();
  });

  async function expectPrivateShareModalAndNoFile() {
    const dialog = await screen.findByText('Only people I add');
    const restricted = dialog.closest('button');
    expect(restricted.getAttribute('aria-pressed'), 'ShareModal defaults to Only people I add').toBe('true');
    expect(screen.getByText('Anyone with the link').closest('button').getAttribute('aria-pressed')).toBe('false');
    expect(navigator.share, 'no native share sheet (no file sent)').not.toHaveBeenCalled();
    const calls = globalThis.apiFetchImpl.mock.calls;
    expect(calls.filter(([u]) => /\/file(\b|-url|\?|$)/.test(String(u))), 'video file never fetched').toHaveLength(0);
    expect(calls.filter(([, o]) => o?.method === 'POST'), 'nothing created before the user confirms').toHaveLength(0);
  }

  const closeModal = async () => {
    fireEvent.keyDown(document, { key: 'Escape' });
    cleanup();
  };

  it('card-face Share', async () => {
    render(<PublishedReelsPanel active onOpenProject={() => {}} />);
    const tab = await screen.findByTestId('collections-tab');
    fireEvent.click(within(tab).getByRole('button', { name: 'Share' }));
    await expectPrivateShareModalAndNoFile();
    await closeModal();
  });

  it('mobile kebab Share', async () => {
    render(<PublishedReelsPanel active onOpenProject={() => {}} />);
    const tab = await screen.findByTestId('collections-tab');
    fireEvent.click(within(tab).getByRole('button', { name: 'More actions' }));
    // The coarse kebab sheet's Share row (the card face's Share is the other "Share" button).
    const shareRows = screen.getAllByRole('button', { name: 'Share' }).filter((b) => b.getAttribute('aria-label') !== 'Share');
    expect(shareRows).toHaveLength(1);
    fireEvent.click(shareRows[0]);
    await expectPrivateShareModalAndNoFile();
    await closeModal();
  });

  it('player Share', async () => {
    render(<PublishedReelsPanel active onOpenProject={() => {}} />);
    const tab = await screen.findByTestId('collections-tab');
    fireEvent.click(within(tab).getAllByRole('button').find((b) => /play/i.test(b.getAttribute('aria-label') || b.textContent)));
    const player = await screen.findByTestId('story-player');
    globalThis.apiFetchImpl.mockClear();
    fireEvent.click(within(player).getByRole('button', { name: 'Player Share' }));
    await waitFor(() => expect(screen.getByText('Only people I add')).toBeTruthy());
    await expectPrivateShareModalAndNoFile();
    await closeModal();
  });
});
