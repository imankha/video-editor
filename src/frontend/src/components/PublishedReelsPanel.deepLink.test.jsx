// T15760: the finished highlight player must keep the URL at /home/published/{id}
// while open (so it can be copied/linked) and restore the same player on a cold
// load of that URL. Bug: the URL stayed at /home throughout -- Play never touched
// it and a reload/copy always landed on the bare Published tab.
//
// Mocks follow the same seams PublishedReelsPanel.intro.test.jsx already uses
// (CollectionsTab's renderCard wires handlePlay; IntroStoryPlayer is mocked to a
// marker exposing onClose).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

vi.mock('../utils/apiFetch', () => ({
  default: (...args) => globalThis.apiFetchImpl(...args),
}));

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

function mockApiFetch({ downloads = [] } = {}) {
  globalThis.apiFetchImpl = vi.fn(async (url) => {
    const s = String(url);
    if (s.includes('/intro-playback')) return { ok: true, json: async () => ({ intro: null }) };
    if (s.endsWith('/api/downloads')) {
      return { ok: true, json: async () => ({ downloads, total_count: downloads.length }) };
    }
    return { ok: true, json: async () => ({}) };
  });
}

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

let capturedRenderCard = null;
vi.mock('./collections/CollectionsTab', () => ({
  CollectionsTab: (props) => {
    capturedRenderCard = props.renderCard;
    return <div data-testid="collections-tab">{props.renderCard(SAMPLE_DOWNLOAD)}</div>;
  },
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

function resetStores() {
  useGalleryStore.setState({ unwatchedCount: 0 });
  useProfileStore.setState({ profiles: [{ id: 'p1', isCurrent: true }], currentProfileId: 'p1' });
  useIntroCardStore.setState({ cards: [] });
}

async function clickPlayOnFirstReel() {
  const playButton = await screen.findByRole('button', { name: 'Watch marked plays' });
  fireEvent.click(playButton);
}

describe('PublishedReelsPanel deep-linkable player URL (T15760)', () => {
  beforeEach(() => {
    resetStores();
    capturedRenderCard = null;
    window.history.replaceState(null, '', '/home/published');
  });

  afterEach(() => {
    vi.clearAllMocks();
    cleanup();
    window.history.replaceState(null, '', '/home/published');
  });

  it('T15760:C1 Play updates the URL to /home/published/{id}, and Close restores /home/published', async () => {
    mockApiFetch();
    render(<PublishedReelsPanel active onOpenProject={() => {}} />);
    expect(capturedRenderCard).toBeTruthy();

    await clickPlayOnFirstReel();
    await screen.findByTestId('intro-story-player');

    expect(window.location.pathname).toBe(`/home/published/${SAMPLE_DOWNLOAD.id}`);

    fireEvent.click(screen.getByTestId('intro-story-player'));
    await waitFor(() => expect(screen.queryByTestId('intro-story-player')).toBeNull());

    expect(window.location.pathname).toBe('/home/published');
  });

  it('T15760:C2 a cold load of /home/published/{id} fetches the download and opens the same player', async () => {
    window.history.replaceState(null, '', `/home/published/${SAMPLE_DOWNLOAD.id}`);
    mockApiFetch({ downloads: [SAMPLE_DOWNLOAD] });

    render(<PublishedReelsPanel active onOpenProject={() => {}} />);

    await waitFor(() => {
      expect(screen.getByTestId('intro-story-player').textContent).toContain(SAMPLE_DOWNLOAD.project_name);
    });
  });
});
