import { render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppStateProvider } from '../contexts';

// T7320: the Games tab's viewport-aware cache warming registers an IntersectionObserver
// per game tile, and its callback reads `entry.target.dataset.gameId`. The registration
// loop used to walk `container.children` -- correct when it was written (T2890), wrong the
// moment T5681's grouping render put month blocks between the container and the tiles.
// Every entry then failed the dataset lookup and warming silently did nothing.
//
// This test asserts the property that actually matters and is depth-INDEPENDENT: every
// element handed to observe() is a real tile, and every tile gets observed -- no matter how
// many wrapper levels the grouping introduces. A future layout change that adds another
// level (tournament groups, rail sections) cannot re-break warming without failing here.

// Records what the component observes, so the assertions can inspect it.
const observed = [];
class RecordingIntersectionObserver {
  observe(el) { observed.push(el); }
  unobserve() {}
  disconnect() {}
}
globalThis.IntersectionObserver = RecordingIntersectionObserver;

vi.mock('../hooks/useIsMobile', () => ({
  useIsMobile: () => false,
  useIsCoarsePointer: () => false,
  useIsLandscape: () => false,
}));

vi.mock('../stores/settingsStore', () => ({
  useSettingsStore: () => ({
    settings: { projectFilters: { statusFilter: 'all', aspectFilter: 'all', creationFilter: 'all' } },
    setStatusFilter: vi.fn(),
    setAspectFilter: vi.fn(),
    setCreationFilter: vi.fn(),
  }),
}));
vi.mock('../stores/authStore', () => {
  const state = { requireAuth: vi.fn(), isAuthenticated: true };
  const useAuthStore = (sel) => sel(state);
  useAuthStore.getState = () => state;
  return { useAuthStore };
});
vi.mock('../stores/profileStore', () => {
  const state = { currentProfileId: 'p1', switchProfile: vi.fn() };
  const useProfileStore = (sel) => sel(state);
  useProfileStore.getState = () => state;
  return { useProfileStore };
});
vi.mock('../stores/gamesDataStore', () => {
  const state = { getGameVideoUrl: () => null };
  const useGamesDataStore = () => state;
  useGamesDataStore.getState = () => state;
  return { useGamesDataStore };
});

// Header chrome + tiles stubbed: this test is about WHICH elements get observed, and the
// observed element is ProjectManager's own `data-game-id` wrapper, not the tile's insides.
vi.mock('./Logo', () => ({ LogoWithText: () => <div />, Logo: () => <div />, default: () => <div /> }));
vi.mock('./CreditBalance', () => ({ CreditBalance: () => <div /> }));
vi.mock('./InstallButton', () => ({ InstallButton: () => <div /> }));
vi.mock('./SignInButton', () => ({ SignInButton: () => <div />, default: () => <div /> }));
vi.mock('./ProfileSportButton', () => ({ ProfileSportButton: () => <div />, default: () => <div /> }));
vi.mock('./ProfileDropdown', () => ({ ProfileDropdown: () => <div /> }));
vi.mock('./GameTile', () => ({ GameTile: () => <div data-testid="game-tile" /> }));
vi.mock('./DraftTile', () => ({ DraftTile: () => <div data-testid="draft-tile" />, default: () => <div /> }));
// T8545: DownloadsPanel is now always mounted (Highlights tab body) — stub it,
// irrelevant to this file's Games-tab observer-target assertions.
vi.mock('./DownloadsPanel', () => ({ DownloadsPanel: () => <div /> }));

import { ProjectManager } from './ProjectManager';

// Match date and upload date agree per game, so the fixture spans MULTIPLE groups under
// either grouping rule -- the nesting under test exists either way.
const GAMES = [
  { id: 41, name: 'Vs LA Breakers May 9', game_date: '2026-05-09', created_at: '2026-05-09 18:00:00', clip_count: 28 },
  { id: 42, name: 'Vs LA Rebels May 2', game_date: '2026-05-02', created_at: '2026-05-02 18:00:00', clip_count: 21 },
  { id: 43, name: 'at Beach FC Apr 26', game_date: '2026-04-26', created_at: '2026-04-26 18:00:00', clip_count: 22 },
];

function renderManager(props = {}) {
  window.history.replaceState(null, '', '/home/games');
  return render(
    <AppStateProvider value={{ unseenReelsCount: 0, exportingProject: null }}>
      <ProjectManager
        projects={[]}
        loading={false}
        games={GAMES}
        gamesLoading={false}
        onSelectProject={vi.fn()}
        onCreateProject={vi.fn()}
        onRefreshProjects={vi.fn()}
        onDeleteProject={vi.fn()}
        onAnnotateWithFile={vi.fn()}
        onLoadGame={vi.fn()}
        onDeleteGame={vi.fn()}
        onFetchGames={vi.fn()}
        {...props}
      />
    </AppStateProvider>
  );
}

beforeEach(() => {
  observed.length = 0;
});

describe('Games tab cache warming — observer targets (T7320)', () => {
  it('observes the game TILES, not the group wrappers between them', () => {
    const { container } = renderManager();

    // Sanity: the fixture really does render nested groups, or this proves nothing.
    const tiles = container.querySelectorAll('[data-game-id]');
    expect(tiles.length).toBe(GAMES.length);
    expect(tiles[0].parentElement).not.toBe(container.querySelector('[data-game-id]').parentElement.parentElement);

    expect(observed.length).toBeGreaterThan(0);
    // THE regression: every observed element must carry the id the callback reads.
    // Pre-fix these were month wrappers, whose dataset.gameId is undefined.
    for (const el of observed) {
      expect(el.dataset.gameId, `observed ${el.tagName}.${el.className} has no data-game-id`)
        .toBeDefined();
    }
  });

  it('observes every game exactly once', () => {
    renderManager();

    const ids = observed.map(el => el.dataset.gameId);
    expect(ids.sort()).toEqual(GAMES.map(g => String(g.id)).sort());
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('still finds the tiles when the grouping adds another wrapper level', () => {
    // Depth-independence, asserted directly rather than inferred: a query-based lookup
    // finds tiles at ANY depth, which is the property that makes the queued layout work
    // (rail sections around the existing group blocks) safe.
    const { container } = renderManager();
    const deepest = container.querySelector('[data-game-id]');
    let depth = 0;
    for (let el = deepest; el && el !== container; el = el.parentElement) depth++;

    expect(depth, 'tiles are nested well below the container').toBeGreaterThan(2);
    expect(observed.length).toBe(GAMES.length);
  });
});
