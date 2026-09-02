import { render, screen, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppStateProvider } from '../contexts';

// T6830: home-screen tab defaults + dead-end Clips-tab guard. These tests render
// the FULL ProjectManager to exercise the real tab-selection paths (initial tab,
// /home/reels deep link) and the derived `clipsTabDisabled` gate on the tab
// button. Heavy presentational children (header chrome, tiles) are stubbed so the
// test stays focused on tab logic, not their internal store wiring.
//
// T8360: the tab was renamed "Reel Drafts" -> "Clips" and now shows only
// single-clip auto-drafts (`clipDrafts = projects.filter(is_auto_created)`).
// The "Build Highlight Reel" button moved off this tab entirely (to
// DownloadsPanel), so it is no longer asserted here as a Clips-tab action.

// jsdom lacks IntersectionObserver (used by the games-grid cache-warming effect).
class MockIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.IntersectionObserver = MockIntersectionObserver;

// jsdom lacks matchMedia (useIsMobile) — stub it.
vi.mock('../hooks/useIsMobile', () => ({
  useIsMobile: () => false,
  useIsCoarsePointer: () => false,
  useIsLandscape: () => false,
}));

// Store mocks — ProjectManager only reads a few fields from each.
vi.mock('../stores/settingsStore', () => ({
  useSettingsStore: () => ({
    settings: { projectFilters: { statusFilter: 'all', aspectFilter: 'all', creationFilter: 'all' } },
    setStatusFilter: vi.fn(),
    setAspectFilter: vi.fn(),
    setCreationFilter: vi.fn(),
  }),
}));
vi.mock('../stores/authStore', () => {
  const state = { requireAuth: vi.fn(), isAuthenticated: false };
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

// Stub the header chrome + tiles so their own store usage doesn't leak into this test.
vi.mock('./Logo', () => ({ LogoWithText: () => <div /> , Logo: () => <div />, default: () => <div /> }));
vi.mock('./CreditBalance', () => ({ CreditBalance: () => <div /> }));
vi.mock('./InstallButton', () => ({ InstallButton: () => <div /> }));
vi.mock('./SignInButton', () => ({ SignInButton: () => <div />, default: () => <div /> }));
vi.mock('./ProfileSportButton', () => ({ ProfileSportButton: () => <div />, default: () => <div /> }));
vi.mock('./ProfileDropdown', () => ({ ProfileDropdown: () => <div /> }));
vi.mock('./GameTile', () => ({ GameTile: () => <div data-testid="game-tile" /> }));
vi.mock('./DraftTile', () => ({ DraftTile: () => <div data-testid="draft-tile" />, default: () => <div /> }));

import { ProjectManager } from './ProjectManager';

const APP_STATE = { unseenReelsCount: 0, exportingProject: null };

function renderManager(props = {}, path = '/home') {
  window.history.replaceState(null, '', path);
  return render(
    <AppStateProvider value={APP_STATE}>
      <ProjectManager
        projects={[]}
        loading={false}
        games={[]}
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

// Prefix match: a loose /Clips/i regex also catches the unrelated "Recent"
// quick-access card's "N clips annotated" caption (accessible name includes
// all descendant text), which isn't the tab. The tab's own accessible name is
// "Clips" with the count chip digit appended directly (no separating space,
// e.g. "Clips1"), so don't require a trailing word boundary.
const clipsTab = () => screen.getByRole('button', { name: /^Clips/i });

describe('ProjectManager home tab defaults (T6830)', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/home');
  });

  it('fresh account (no games, no drafts): lands on Games, Clips tab disabled with tooltip', async () => {
    renderManager();

    // Games tab is active -> its action button (Add Game) is shown.
    expect(screen.getByRole('button', { name: 'Add Game' })).toBeTruthy();
    // Build Highlight Reel is NOT shown here (T8360: it moved off Home entirely,
    // to DownloadsPanel's Highlight Reels surface).
    expect(screen.queryByRole('button', { name: 'Build Highlight Reel' })).toBeNull();

    const tab = clipsTab();
    expect(tab.disabled).toBe(true);
    expect(tab.getAttribute('title')).toMatch(/Extract clips from a game first/i);
  });

  it('/home/reels deep link in the dead-end state falls back to Games', async () => {
    renderManager({}, '/home/reels');

    // Redirect effect moves the disabled-state user off the dead tab onto Games.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Add Game' })).toBeTruthy();
    });
    expect(window.location.pathname).toBe('/home/games');
    expect(clipsTab().disabled).toBe(true);
  });

  it('user with extracted clips but no drafts: Clips tab is ENABLED (asymmetry)', () => {
    renderManager({ games: [{ id: 1, clip_count: 3, created_at: '2026-08-01T00:00:00Z' }] });

    expect(clipsTab().disabled).toBe(false);
  });

  it('user with drafts: unchanged default (T5677) — lands on Clips, tab enabled', async () => {
    // T8360: clipDrafts (the Clips tab's count/default driver) is auto-drafts
    // only -- is_auto_created: true is required for this fixture to land there.
    renderManager({ projects: [{ id: 7, name: 'A Reel', game_ids: [], is_auto_created: true }] });

    const tab = clipsTab();
    expect(tab.disabled).toBe(false);
    // Projects-count default flips the active tab to Clips once projects load,
    // so its count chip appears. The Build Highlight Reel action no longer lives
    // on this tab (T8360 relocated it to DownloadsPanel).
    await waitFor(() => {
      expect(within(tab).getByText('1')).toBeTruthy();
    });
    expect(screen.queryByRole('button', { name: 'Build Highlight Reel' })).toBeNull();
  });

  it('user with only multi-clip (Highlights) drafts: Clips tab stays on the dead-end guard (T8360)', async () => {
    // A multi-clip draft (is_auto_created: false) does NOT count toward clipDrafts
    // -- it belongs to the Highlights section in DownloadsPanel, not the Clips tab.
    renderManager({ projects: [{ id: 8, name: 'A Highlight', game_ids: [], is_auto_created: false }] });

    const tab = clipsTab();
    expect(tab.disabled).toBe(true);
  });

  it('mid-load (games still loading): Clips NOT disabled — no disabled->enabled flash', () => {
    renderManager({ gamesLoading: true });

    // A user who actually has clips would render disabled for a frame if we didn't
    // gate on load settling; keep it enabled until both lists settle.
    expect(clipsTab().disabled).toBe(false);
  });
});
