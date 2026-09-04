import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppStateProvider } from '../contexts';

// T7890: the "Add Game" CTA is the entry gesture of the signup->first-upload cliff.
// It must fire the `add_game_opened` funnel beacon AND open the picker without the
// beacon ever delaying it (fire-and-forget). These tests render the real
// ProjectManager + real GameDetailsModal so the gesture wiring is exercised end to
// end; heavy presentational children are stubbed to keep the test focused.

class MockIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.IntersectionObserver = MockIntersectionObserver;

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

// requireAuth is swappable per test: when the user is authed it invokes the
// callback (the funnel cohort is signed-up users); when not, it withholds it
// (e.g. opens an auth modal), and the beacon must NOT fire.
const { requireAuthImpl } = vi.hoisted(() => ({ requireAuthImpl: { authed: true } }));
vi.mock('../stores/authStore', () => {
  const state = {
    requireAuth: (cb) => { if (requireAuthImpl.authed) cb(); },
    isAuthenticated: true,
  };
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

// Capture the beacon.
const { recordAchievementSpy } = vi.hoisted(() => ({ recordAchievementSpy: vi.fn() }));
vi.mock('../stores/questStore', () => {
  const state = { setAddGameOpener: vi.fn(), recordAchievement: recordAchievementSpy };
  const useQuestStore = (sel) => (sel ? sel(state) : state);
  useQuestStore.getState = () => state;
  return { useQuestStore };
});

// Header chrome + tiles — irrelevant to the gesture, stub to avoid store leakage.
vi.mock('./Logo', () => ({ LogoWithText: () => <div />, Logo: () => <div />, default: () => <div /> }));
vi.mock('./CreditBalance', () => ({ CreditBalance: () => <div /> }));
vi.mock('./InstallButton', () => ({ InstallButton: () => <div /> }));
vi.mock('./SignInButton', () => ({ SignInButton: () => <div />, default: () => <div /> }));
vi.mock('./ProfileSportButton', () => ({ ProfileSportButton: () => <div />, default: () => <div /> }));
vi.mock('./ProfileDropdown', () => ({ ProfileDropdown: () => <div /> }));
vi.mock('./GameTile', () => ({ GameTile: () => <div data-testid="game-tile" /> }));
vi.mock('./DraftTile', () => ({ DraftTile: () => <div data-testid="draft-tile" />, default: () => <div /> }));
// T8555: PublishedReelsPanel is always mounted (Published tab body) — stub it,
// irrelevant to this file's Add Game gesture.
vi.mock('./PublishedReelsPanel', () => ({ PublishedReelsPanel: () => <div /> }));

import { ProjectManager } from './ProjectManager';

const APP_STATE = { unseenReelsCount: 0, exportingProject: null };

function renderManager(props = {}) {
  window.history.replaceState(null, '', '/home');
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

describe('ProjectManager — T7890 add_game_opened funnel beacon', () => {
  beforeEach(() => {
    requireAuthImpl.authed = true;
    recordAchievementSpy.mockClear();
  });

  it('fires add_game_opened AND opens the picker on the Add Game gesture', async () => {
    renderManager();

    fireEvent.click(screen.getByRole('button', { name: 'Add Game' }));

    // Picker (GameDetailsModal) opened, and the beacon fired exactly once — the
    // beacon is fire-and-forget (session-deduped in the real store) and never gates
    // the picker (opened in the same synchronous gesture).
    await waitFor(() => expect(screen.getByText('Add New Game')).toBeTruthy());
    expect(recordAchievementSpy).toHaveBeenCalledWith('add_game_opened');
    expect(recordAchievementSpy).toHaveBeenCalledTimes(1);
  });

  it('does NOT fire the beacon when auth is required and withheld (no picker)', () => {
    // Gated inside the authed callback: an unauthenticated click routes to the auth
    // modal, opens no picker, and must leave no funnel footprint for a non-cohort user.
    requireAuthImpl.authed = false;
    renderManager();

    fireEvent.click(screen.getByRole('button', { name: 'Add Game' }));

    expect(screen.queryByText('Add New Game')).toBeNull();
    expect(recordAchievementSpy).not.toHaveBeenCalled();
  });
});
