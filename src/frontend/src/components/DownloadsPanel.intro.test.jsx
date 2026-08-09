// T6700 -- owner in-app playback intro: DownloadsPanel gains an intro-playback
// fetch + unmount/mount SWAP (design §5.2, §7) that does not exist yet as of
// this session. `handlePlay` (single reel) and `onPlayCollection` (collection)
// currently just `setStoryPlayer(...)` and render `<CollectionPlayer>`
// directly -- no `intro`/`introShowing` state, no fetch to
// `/api/downloads/{id}/intro-playback` or `/api/collections/intro-playback`,
// no `<IntroPreRoll>` mount. These tests fail until Stage 4 wires the swap
// exactly as SharedCollectionView.jsx already does (the copied precedent).
//
// Heavy child components (CollectionsTab, RankingGame, ConfidenceBanner) are
// mocked to keep this a focused unit test of the swap/fetch logic living in
// DownloadsPanel itself, not a full-panel integration test. The mocked
// CollectionsTab captures BOTH `renderCard` (the panel's per-reel card
// factory, which wires handlePlay) and `onPlayCollection` so the test can
// drive each play path exactly the way the real CollectionsTab does.
// `CollectionPlayer` and `IntroPreRoll` are mocked as simple test-id markers
// so we can assert genuine mount/unmount (not just prop values) -- the
// design's "swap, not toggle" claim (§3) is only proven if CollectionPlayer
// is truly ABSENT from the tree while the intro shows.

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
// ---------------------------------------------------------------------------
vi.mock('../hooks/useDownloads', () => ({
  useDownloads: () => ({
    downloads: [],
    deleteDownload: vi.fn(),
    downloadFile: vi.fn(),
    downloadingId: null,
    renameDownload: vi.fn(),
    setIntroCard: vi.fn(),
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

vi.mock('./collections/CollectionPlayer', () => ({
  CollectionPlayer: (props) => (
    <div data-testid="collection-player" onClick={props.onClose}>
      collection player: {props.title}
    </div>
  ),
}));

vi.mock('./introcards/IntroPreRoll', () => ({
  IntroPreRoll: (props) =>
    props.intro ? (
      <div data-testid="intro-pre-roll" onClick={props.onDone}>
        intro pre-roll
      </div>
    ) : null,
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
  useGalleryStore.setState({ isOpen: true, unwatchedCount: 0 });
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

describe('DownloadsPanel intro-playback swap (T6700)', () => {
  describe('single-reel play', () => {
    it('fetches intro-playback and mounts IntroPreRoll instead of CollectionPlayer when intro is non-null', async () => {
      mockApiFetch(SAMPLE_INTRO);

      render(<DownloadsPanel onOpenProject={() => {}} />);
      expect(capturedRenderCard).toBeTruthy();

      await clickPlayOnFirstReel();

      await waitFor(() => {
        expect(globalThis.apiFetchImpl).toHaveBeenCalledWith(
          expect.stringContaining(`/api/downloads/${SAMPLE_DOWNLOAD.id}/intro-playback`),
        );
      });

      // Swap, not toggle: CollectionPlayer must be genuinely ABSENT while
      // the intro shows (design §3), not merely hidden/toggled off.
      await waitFor(() => {
        expect(screen.getByTestId('intro-pre-roll')).toBeTruthy();
      });
      expect(screen.queryByTestId('collection-player')).toBeNull();
    });

    it('never mounts IntroPreRoll and mounts the player immediately when intro-playback returns intro: null', async () => {
      mockApiFetch(null);

      render(<DownloadsPanel onOpenProject={() => {}} />);
      await clickPlayOnFirstReel();

      await waitFor(() => {
        expect(screen.getByTestId('collection-player')).toBeTruthy();
      });
      expect(screen.queryByTestId('intro-pre-roll')).toBeNull();
    });

    it('onDone flips the swap: IntroPreRoll unmounts and CollectionPlayer mounts', async () => {
      mockApiFetch(SAMPLE_INTRO);

      render(<DownloadsPanel onOpenProject={() => {}} />);
      await clickPlayOnFirstReel();

      const preRoll = await waitFor(() => screen.getByTestId('intro-pre-roll'));
      fireEvent.click(preRoll); // fires onDone in our mock

      await waitFor(() => {
        expect(screen.getByTestId('collection-player')).toBeTruthy();
      });
      expect(screen.queryByTestId('intro-pre-roll')).toBeNull();
    });
  });

  describe('open -> close -> open re-gates introShowing (R6)', () => {
    it('does not leave a stale introShowing=true on reopen when the second play has no intro', async () => {
      mockApiFetch(SAMPLE_INTRO);

      render(<DownloadsPanel onOpenProject={() => {}} />);
      await clickPlayOnFirstReel();
      await waitFor(() => expect(screen.getByTestId('intro-pre-roll')).toBeTruthy());

      // Advance into the player, then close it (CollectionPlayer mock's
      // onClick calls onClose) -- mirrors a real close from mid-playback.
      fireEvent.click(screen.getByTestId('intro-pre-roll'));
      await waitFor(() => expect(screen.getByTestId('collection-player')).toBeTruthy());
      fireEvent.click(screen.getByTestId('collection-player'));

      await waitFor(() => {
        expect(screen.queryByTestId('collection-player')).toBeNull();
        expect(screen.queryByTestId('intro-pre-roll')).toBeNull();
      });

      // Reopen with a null-intro response this time -- introShowing must
      // re-gate from the fresh payload, not carry over `true` from before.
      mockApiFetch(null);
      await clickPlayOnFirstReel();

      await waitFor(() => expect(screen.getByTestId('collection-player')).toBeTruthy());
      expect(screen.queryByTestId('intro-pre-roll')).toBeNull();
    });
  });

  describe('collection play', () => {
    it('fetches /api/collections/intro-playback and swaps in IntroPreRoll for a non-null collection intro', async () => {
      mockApiFetch(SAMPLE_INTRO);

      render(<DownloadsPanel onOpenProject={() => {}} />);
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
      await waitFor(() => expect(screen.getByTestId('intro-pre-roll')).toBeTruthy());
      expect(screen.queryByTestId('collection-player')).toBeNull();
    });
  });
});
