// T16050:C1 - the finished-highlight player (PublishedReelsPanel's
// openDownloadPlayer, the Play gesture's handler) wires the [LOAD] trace
// (src/utils/loadTrace.js) around its intro-playback fetch -- the only wait
// in this path, since the video itself (download.file_url) is already
// resolved from the gallery data this panel loaded. Reuses
// PublishedReelsPanel.intro.test.jsx's harness.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

vi.mock('../utils/apiFetch', () => ({
  default: (...args) => globalThis.apiFetchImpl(...args),
}));

function mockApiFetch(introPlaybackResponse) {
  globalThis.apiFetchImpl = vi.fn(async (url) => {
    if (typeof url === 'string' && url.includes('/intro-playback')) {
      return { ok: true, json: async () => ({ intro: introPlaybackResponse }) };
    }
    return { ok: true, json: async () => ({}) };
  });
}

function mockApiFetchFailing() {
  globalThis.apiFetchImpl = vi.fn(async (url) => {
    if (typeof url === 'string' && url.includes('/intro-playback')) {
      throw new Error('network down');
    }
    return { ok: true, json: async () => ({}) };
  });
}

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

vi.mock('./collections/CollectionsTab', () => ({
  CollectionsTab: (props) => (
    <div data-testid="collections-tab">{props.renderCard(SAMPLE_DOWNLOAD)}</div>
  ),
}));

vi.mock('./ranking/ConfidenceBanner', () => ({ ConfidenceBanner: () => null }));
vi.mock('./ranking/RankingGame', () => ({ RankingGame: () => null }));
vi.mock('./introcards/IntroStoryPlayer', () => ({
  IntroStoryPlayer: (props) => (
    <div data-testid="intro-story-player" onClick={props.onClose}>story player: {props.title}</div>
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

function infoLines() {
  return console.info.mock.calls.map((args) => args.join(' '));
}

async function clickPlayOnFirstReel() {
  const playButton = await screen.findByRole('button', { name: 'Watch marked plays' });
  fireEvent.click(playButton);
}

describe('T16050 PublishedReelsPanel (finished highlight player) [LOAD] trace wiring', () => {
  beforeEach(() => {
    resetStores();
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    cleanup();
  });

  it('T16050:C1 logs a waiting-for line and an arrived+settled line when intro-playback resolves', async () => {
    mockApiFetch(SAMPLE_INTRO);

    render(<PublishedReelsPanel active onOpenProject={() => {}} />);
    await clickPlayOnFirstReel();

    await waitFor(() => {
      expect(infoLines().some((l) => l.includes('[LOAD] FinishedHighlightPlayer waiting for intro'))).toBe(true);
    });
    expect(infoLines().some((l) => l.includes('downloadId=42'))).toBe(true);
    await waitFor(() => {
      expect(infoLines().some((l) => l.includes('[LOAD] FinishedHighlightPlayer intro arrived'))).toBe(true);
    });
    expect(infoLines().some((l) => l.includes('[LOAD] FinishedHighlightPlayer settled in'))).toBe(true);
  });

  it('logs intro empty (not arrived) when intro-playback returns intro: null', async () => {
    mockApiFetch(null);

    render(<PublishedReelsPanel active onOpenProject={() => {}} />);
    await clickPlayOnFirstReel();

    await waitFor(() => {
      expect(infoLines().some((l) => l.includes('[LOAD] FinishedHighlightPlayer intro empty'))).toBe(true);
    });
    expect(infoLines().some((l) => l.includes('[LOAD] FinishedHighlightPlayer intro arrived'))).toBe(false);
  });

  it('logs intro failed when the intro-playback fetch throws', async () => {
    mockApiFetchFailing();

    render(<PublishedReelsPanel active onOpenProject={() => {}} />);
    await clickPlayOnFirstReel();

    await waitFor(() => {
      expect(infoLines().some((l) => l.includes('[LOAD] FinishedHighlightPlayer intro failed'))).toBe(true);
    });
  });
});
