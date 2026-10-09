// T12200: the user's finished highlight (CollectionsTab) leads the Finished tab;
// the locked ranking gauge (ConfidenceBanner) must not outrank it (qa-34).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

// ---------------------------------------------------------------------------
// apiFetch mock (matches useWebShare.test.js's convention: a vi.mock factory
// reading a globalThis hook the test body configures per-case).
// ---------------------------------------------------------------------------
vi.mock('../utils/apiFetch', () => ({
  default: (...args) => globalThis.apiFetchImpl(...args),
}));

function mockApiFetch(introPlaybackResponse = null) {
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
// Heavy child mocks -- keep this a PublishedReelsPanel-logic unit test. The mocked
// CollectionsTab captures the two seams the panel's play paths route through:
// `renderCard` (per-reel card, wired to handlePlay) and `onPlayCollection`.
// ---------------------------------------------------------------------------
vi.mock('./collections/CollectionsTab', () => ({
  CollectionsTab: () => <div data-testid="collections-tab" />,
}));

vi.mock('./ranking/ConfidenceBanner', () => ({ ConfidenceBanner: () => <div data-testid="ranking-banner" /> }));
vi.mock('./ranking/RankingGame', () => ({ RankingGame: () => null }));

// T6710: PublishedReelsPanel now mounts ONE composite (IntroStoryPlayer) instead
// of separately mounting CollectionPlayer/IntroPreRoll itself -- mock the
// composite as a marker exposing the intro/reels props it received. `onClick`
// simulates the composite's own onClose forwarding (mirrors the old
// CollectionPlayer mock's onClose wiring) so the close-then-reopen (R6) flow
// still exercises PublishedReelsPanel's real state, not IntroStoryPlayer's
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

import { PublishedReelsPanel } from './PublishedReelsPanel';
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
});

afterEach(() => {
  vi.clearAllMocks();
  cleanup();
});

describe('PublishedReelsPanel ordering (T12200)', () => {
  it('T12200:C1 renders the highlights list before the locked ranking banner', async () => {
    mockApiFetch();
    render(<PublishedReelsPanel active onOpenProject={() => {}} />);

    const tab = await screen.findByTestId('collections-tab');
    const banner = screen.getByTestId('ranking-banner');
    expect(tab.compareDocumentPosition(banner) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
