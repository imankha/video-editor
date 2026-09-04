// T6700 -- owner in-app playback intro: DownloadsPanel fetches the
// intro-playback payload on the Play gesture (design §5.2, §7) and hands it
// to the player. `handlePlay` (single reel) and `onPlayCollection`
// (collection) fetch `/api/downloads/{id}/intro-playback` /
// `/api/collections/intro-playback` and stash the result on
// `storyPlayer.intro`.
//
// T6710: the render target changed from an unmount/mount
// IntroPreRoll/CollectionPlayer SWAP ternary to a single composite,
// `IntroStoryPlayer`, which owns the intro-vs-reels region ITSELF (see
// IntroStoryPlayer.test.jsx for that composite's own region-routing
// coverage). DownloadsPanel's job narrowed to "fetch on Play, hand the
// payload to the composite" -- this file mocks IntroStoryPlayer as a simple
// test-id marker exposing the props it received, so these tests stay a
// focused unit test of DownloadsPanel's OWN fetch/state logic without
// duplicating IntroStoryPlayer's internal region-switching coverage.
//
// Heavy child components (CollectionsTab, RankingGame, ConfidenceBanner) are
// mocked to keep this a focused unit test of the fetch logic living in
// DownloadsPanel itself, not a full-panel integration test. The mocked
// CollectionsTab captures BOTH `renderCard` (the panel's per-reel card
// factory, which wires handlePlay) and `onPlayCollection` so the test can
// drive each play path exactly the way the real CollectionsTab does.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

// ---------------------------------------------------------------------------
// apiFetch mock (matches useWebShare.test.js's convention: a vi.mock factory
// reading a globalThis hook the test body configures per-case).
// ---------------------------------------------------------------------------
vi.mock('../utils/apiFetch', () => ({
  default: (...args) => globalThis.apiFetchImpl(...args),
}));

function mockApiFetch(introPlaybackResponse) {
  globalThis.apiFetchImpl = vi.fn(async (url) => {
    if (typeof url === 'string' && url.includes('/intro-playback')) {
      return { ok: true, json: async () => ({ intro: introPlaybackResponse }) };
    }
    // Every other call this mount fires (intro cards, collections/intro
    // batch, etc.) degrades harmlessly -- not under test here.
    return { ok: true, json: async () => ({}) };
  });
}

// ---------------------------------------------------------------------------
// Data-layer hook mocks -- one seeded download, no real network/store wiring.
// The prune fns are hoisted + stable so (a) the T6950 effect's deps don't
// churn identity every render and (b) the cascade test below can assert on
// them.
// ---------------------------------------------------------------------------
const hookMocks = vi.hoisted(() => ({
  pruneDownloadsIntroCards: vi.fn(),
  pruneMembersIntroCards: vi.fn(),
}));

vi.mock('../hooks/useDownloads', () => ({
  useDownloads: () => ({
    downloads: [],
    deleteDownload: vi.fn(),
    downloadFile: vi.fn(),
    downloadingId: null,
    renameDownload: vi.fn(),
    setIntroCard: vi.fn(),
    pruneDanglingIntroCards: hookMocks.pruneDownloadsIntroCards,
    markWatched: vi.fn(),
    formatDate: () => '',
  }),
}));

vi.mock('../hooks/useCollections', () => ({
  useCollections: () => ({
    summary: null,
    summaryState: 'ready',
    members: {},
    memberStates: {},
    fetchSummary: vi.fn(),
    fetchMembers: vi.fn(),
    removeMember: vi.fn(),
    patchMember: vi.fn(),
    resortMembers: vi.fn(),
    pruneDanglingIntroCards: hookMocks.pruneMembersIntroCards,
  }),
}));

// ---------------------------------------------------------------------------
// Heavy child mocks -- keep this a DownloadsPanel-logic unit test. The mocked
// CollectionsTab captures the two seams the panel's play paths route through:
// `renderCard` (per-reel card, wired to handlePlay) and `onPlayCollection`.
// ---------------------------------------------------------------------------
let capturedRenderCard = null;
let capturedOnPlayCollection = null;
vi.mock('./collections/CollectionsTab', () => ({
  CollectionsTab: (props) => {
    capturedRenderCard = props.renderCard;
    capturedOnPlayCollection = props.onPlayCollection;
    return (
      <div data-testid="collections-tab">
        {props.renderCard(SAMPLE_DOWNLOAD)}
      </div>
    );
  },
}));

vi.mock('./ranking/ConfidenceBanner', () => ({ ConfidenceBanner: () => null }));
vi.mock('./ranking/RankingGame', () => ({ RankingGame: () => null }));

// T6710: DownloadsPanel now mounts ONE composite (IntroStoryPlayer) instead
// of separately mounting CollectionPlayer/IntroPreRoll itself -- mock the
// composite as a marker exposing the intro/reels props it received. `onClick`
// simulates the composite's own onClose forwarding (mirrors the old
// CollectionPlayer mock's onClose wiring) so the close-then-reopen (R6) flow
// still exercises DownloadsPanel's real state, not IntroStoryPlayer's
// internals (covered separately by IntroStoryPlayer.test.jsx).
vi.mock('./introcards/IntroStoryPlayer', () => ({
  IntroStoryPlayer: (props) => (
    <div
      data-testid="intro-story-player"
      data-has-intro={String(!!props.intro)}
      onClick={props.onClose}
    >
      story player: {props.title}
    </div>
  ),
}));

import { DownloadsPanel } from './DownloadsPanel';
import { useGalleryStore } from '../stores/galleryStore';
import { useProfileStore } from '../stores/profileStore';
import { useIntroCardStore } from '../stores/introCardStore';

const SAMPLE_DOWNLOAD = {
  id: 42,
  project_name: 'Test Reel',
  filename: 'test.mp4',
  created_at: '2026-08-01T00:00:00Z',
  duration: 12.5,
  aspect_ratio: '9:16',
  watched_at: '2026-08-01T00:00:00Z',
  clip_count: 1,
  source_type: 'custom_project',
};

const SAMPLE_INTRO = {
  card: { id: 5, image_key: 'k.png', treatment: 'gold', shown_fields: [], text_elements: {} },
  previewUrl: 'https://r2.example/card.jpg',
  field_values: {},
  profile: {},
};

function resetStores() {
  useGalleryStore.setState({ unwatchedCount: 0 });
  useProfileStore.setState({ profiles: [{ id: 'p1', isCurrent: true }], currentProfileId: 'p1' });
  useIntroCardStore.setState({ cards: [] });
}

beforeEach(() => {
  resetStores();
  capturedRenderCard = null;
  capturedOnPlayCollection = null;
});

afterEach(() => {
  vi.clearAllMocks();
  cleanup();
});

// Fires the SAME click DownloadsPanel wires to ReelTile's Play control --
// ReelTile renders a dedicated `aria-label="Play video"` button whose onClick
// is `onPlay(e, download)` (ReelTile.jsx:262), which the panel wires straight
// to `handlePlay` via `renderDownloadCard`'s `onPlay={handlePlay}` prop.
async function clickPlayOnFirstReel() {
  const playButton = await screen.findByRole('button', { name: 'Play video' });
  fireEvent.click(playButton);
}

describe('DownloadsPanel intro-playback fetch + composite mount (T6700 / T6710)', () => {
  describe('single-reel play', () => {
    it('fetches intro-playback and mounts IntroStoryPlayer with a non-null intro', async () => {
      mockApiFetch(SAMPLE_INTRO);

      render(<DownloadsPanel active onOpenProject={() => {}} />);
      expect(capturedRenderCard).toBeTruthy();

      await clickPlayOnFirstReel();

      await waitFor(() => {
        expect(globalThis.apiFetchImpl).toHaveBeenCalledWith(
          expect.stringContaining(`/api/downloads/${SAMPLE_DOWNLOAD.id}/intro-playback`),
        );
      });

      // T6710: DownloadsPanel mounts ONE composite regardless of intro
      // presence -- IntroStoryPlayer itself owns the intro-vs-reels region
      // (covered by IntroStoryPlayer.test.jsx). This file only proves the
      // fetched intro reached the composite.
      await waitFor(() => {
        expect(screen.getByTestId('intro-story-player').dataset.hasIntro).toBe('true');
      });
    });

    it('mounts IntroStoryPlayer with intro=null when intro-playback returns intro: null', async () => {
      mockApiFetch(null);

      render(<DownloadsPanel active onOpenProject={() => {}} />);
      await clickPlayOnFirstReel();

      await waitFor(() => {
        expect(screen.getByTestId('intro-story-player').dataset.hasIntro).toBe('false');
      });
    });
  });

  describe('open -> close -> open refetches on each Play (R6)', () => {
    it('does not leave a stale intro on reopen when the second play has no intro', async () => {
      mockApiFetch(SAMPLE_INTRO);

      render(<DownloadsPanel active onOpenProject={() => {}} />);
      await clickPlayOnFirstReel();
      await waitFor(() => expect(screen.getByTestId('intro-story-player').dataset.hasIntro).toBe('true'));

      // Close (the mock's onClick forwards onClose) -- mirrors a real close
      // from mid-playback.
      fireEvent.click(screen.getByTestId('intro-story-player'));
      await waitFor(() => expect(screen.queryByTestId('intro-story-player')).toBeNull());

      // Reopen with a null-intro response this time -- must re-fetch and
      // re-gate from the fresh payload, not carry over the prior intro.
      mockApiFetch(null);
      await clickPlayOnFirstReel();

      await waitFor(() => {
        expect(screen.getByTestId('intro-story-player').dataset.hasIntro).toBe('false');
      });
    });
  });

  describe('card-delete cascade mirror (T6950)', () => {
    it('a deleteRevision bump prunes dangling intro cards from BOTH reel-list caches', async () => {
      mockApiFetch(null);
      useIntroCardStore.setState({ cards: [{ id: 1, name: 'Kept card' }] });

      render(<DownloadsPanel active onOpenProject={() => {}} />);
      const before = useIntroCardStore.getState().deleteRevision;

      // What deleteCard does after a successful DELETE: the surviving library
      // plus a revision bump. The panel must reconcile its cached reel lists
      // against the surviving ids.
      useIntroCardStore.setState({ deleteRevision: before + 1 });

      await waitFor(() => {
        expect(hookMocks.pruneMembersIntroCards).toHaveBeenCalledTimes(1);
      });
      const liveIds = hookMocks.pruneMembersIntroCards.mock.calls[0][0];
      expect(liveIds instanceof Set).toBe(true);
      expect([...liveIds]).toEqual([1]);
      expect(hookMocks.pruneDownloadsIntroCards).toHaveBeenCalledWith(liveIds);
    });
  });

  describe('collection play', () => {
    it('fetches /api/collections/intro-playback and passes a non-null intro to IntroStoryPlayer', async () => {
      mockApiFetch(SAMPLE_INTRO);

      render(<DownloadsPanel active onOpenProject={() => {}} />);
      expect(capturedOnPlayCollection).toBeTruthy();

      capturedOnPlayCollection(
        [{ id: 1, name: 'Member 1', streamUrl: 'x', aspect_ratio: '9:16', duration: 5 }],
        'My Collection',
        { scope: { type: 'mixes' }, filter: {}, aspect_ratio: '9:16' },
      );

      await waitFor(() => {
        expect(globalThis.apiFetchImpl).toHaveBeenCalledWith(
          expect.stringContaining('/api/collections/intro-playback'),
        );
      });
      await waitFor(() => {
        expect(screen.getByTestId('intro-story-player').dataset.hasIntro).toBe('true');
      });
    });
  });
});
