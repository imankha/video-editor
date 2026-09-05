import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
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
// The "Create Highlight Reel" button moved off this tab entirely (to
// DownloadsPanel), so it is no longer asserted here as a Clips-tab action.
//
// T8545: Highlight Reels is now a third peer tab (was a top-right icon
// button/drawer). DownloadsPanel is stubbed here (like the other heavy
// children) since this file's focus is tab-selection logic, not the
// Highlights tab's own content -- the stub echoes its `active` prop so tests
// can assert which tab is showing.

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
vi.mock('./PublishedReelsPanel', () => ({
  PublishedReelsPanel: (props) => <div data-testid="published-tab-panel" data-active={String(!!props.active)} />,
}));

import { ProjectManager } from './ProjectManager';
import { useGalleryStore } from '../stores/galleryStore';

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

// Prefix match on the tab's own accessible name. T8555: the Clips tab label is
// now "In Progress Clips" with the count chip digit appended directly (no
// separating space, e.g. "In Progress Clips1"), so match the prefix.
const clipsTab = () => screen.getByRole('button', { name: /^In Progress Clips/i });

describe('ProjectManager home tab defaults (T6830)', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/home');
    useGalleryStore.setState({ isOpen: false });
  });

  it('fresh account (no games, no drafts): lands on Games, Clips tab REACHABLE (T8380)', async () => {
    renderManager();

    // Games tab is active, empty -> "Add Game" resolves the "No games yet"
    // message directly below it (T8780), same order as Reels/Published.
    const message = screen.getByText('No games yet');
    const addGameButton = screen.getByRole('button', { name: 'Add Game' });
    expect(message.compareDocumentPosition(addGameButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The "Build New Reel" assembly button is NOT shown on the Games tab
    // (T8555: it lives on the In Progress Reels tab body only).
    expect(screen.queryByRole('button', { name: 'Build New Reel' })).toBeNull();

    // T8380: the In Progress Clips tab is no longer a dead end -- "Add Video"
    // makes it a valid clip-creation entry point, so it must be reachable even
    // for a zero-content account. The old disabled state + T8780 caption are gone.
    const tab = clipsTab();
    expect(tab.disabled).toBe(false);
    expect(tab.getAttribute('title')).toBeNull();
    expect(screen.queryByText(/Extract clips from a game first using Annotate mode to unlock/i)).toBeNull();

    // Clicking in shows the two-path empty state (upload directly OR extract in
    // Annotate), including the Add Video CTA and its tutorial anchor.
    fireEvent.click(tab);
    const addVideo = await screen.findByRole('button', { name: 'Add Video' });
    expect(addVideo.getAttribute('data-tutorial-target')).toBe('clips-add-video');
    expect(screen.getByText(/Clip Out Play/i)).toBeTruthy();
  });

  it('games still loading: "Add Game" stays visible (does not wait for the empty check to resolve)', async () => {
    renderManager({ gamesLoading: true });

    // T8780: gamesEmptyConfirmed is gated on !gamesLoading, so the button
    // shouldn't disappear mid-fetch just because `games` is momentarily [].
    expect(screen.getByRole('button', { name: 'Add Game' })).toBeTruthy();
  });

  it('/home/reels deep link on a zero-content account STAYS on Clips (T8380: no dead-end redirect)', async () => {
    renderManager({}, '/home/reels');

    // T8380: the old redirect effect (bounce off the dead-end Clips tab onto
    // Games) was removed -- /home/reels is now a valid landing surface, so the
    // Add Video CTA is shown in place and the URL is not rewritten to Games.
    const addVideo = await screen.findByRole('button', { name: 'Add Video' });
    expect(addVideo.getAttribute('data-tutorial-target')).toBe('clips-add-video');
    expect(window.location.pathname).toBe('/home/reels');
    expect(clipsTab().disabled).toBe(false);
  });

  it('user with extracted clips but no drafts: Clips tab is enabled', () => {
    renderManager({ games: [{ id: 1, clip_count: 3, created_at: '2026-08-01T00:00:00Z' }] });

    expect(clipsTab().disabled).toBe(false);
  });

  it('user with drafts: unchanged default (T5677) — lands on Clips, tab enabled', async () => {
    // T8360: clipDrafts (the Clips tab's count/default driver) is auto-drafts
    // only -- is_auto_created: true is required for this fixture to land there.
    renderManager({ projects: [{ id: 7, name: 'A Reel', game_ids: [], is_auto_created: true }] });

    const tab = clipsTab();
    expect(tab.disabled).toBe(false);
    // Projects-count default flips the active tab to In Progress Clips once
    // projects load, so its count chip appears. T8545: the button renders TWO
    // count badges (mobile corner + desktop inline, one hidden per breakpoint
    // via CSS that jsdom doesn't evaluate) -- getAllByText covers both. The
    // "Build New Reel" action lives on the In Progress Reels tab, not here.
    await waitFor(() => {
      expect(within(tab).getAllByText('1').length).toBeGreaterThan(0);
    });
    expect(screen.queryByRole('button', { name: 'Build New Reel' })).toBeNull();
  });

  it('user with only multi-clip (In Progress Reels) drafts: Clips tab is still reachable (T8380)', async () => {
    // A multi-clip draft (is_auto_created: false) does NOT count toward clipDrafts
    // -- it belongs to the In Progress Reels tab, not the In Progress Clips tab.
    // Pre-T8380 this left the Clips tab on the dead-end guard; now Add Video keeps
    // it reachable regardless.
    renderManager({ projects: [{ id: 8, name: 'A Highlight', game_ids: [], is_auto_created: false }] });

    const tab = clipsTab();
    expect(tab.disabled).toBe(false);
  });

  it('mid-load (games still loading): Clips NOT disabled — no disabled->enabled flash', () => {
    renderManager({ gamesLoading: true });

    // A user who actually has clips would render disabled for a frame if we didn't
    // gate on load settling; keep it enabled until both lists settle.
    expect(clipsTab().disabled).toBe(false);
  });
});

// T8555: the four-tab navigation contract (Games / In Progress Clips /
// In Progress Reels / Published), badge relocation, deep links, and the
// publish-landing effect are covered in ProjectManager.fourTabIA.test.jsx
// (this file's old "three-way tab navigation (T8545)" block was superseded by
// that four-tab split). This file keeps only the home-tab-defaults (T6830)
// dead-end/asymmetry coverage above.
