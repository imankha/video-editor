import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { AppStateProvider } from '../contexts';

// T13490: switching Home tabs must land at the top of the new tab. The scroller is
// App's `flex-1 overflow-auto` wrapper, which keeps its scrollTop across tab switches
// (a long Games tab left Finished opened at its foot, under a "Scroll up" pill).

globalThis.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };

vi.mock('../hooks/useIsMobile', () => ({
  useIsMobile: () => false,
  useIsCoarsePointer: () => false,
  useIsLandscape: () => false,
}));
vi.mock('../stores/settingsStore', () => ({
  useGuidanceSettings: () => ({ coachEnabled: true }),
  useSettingsStore: () => ({
    settings: { projectFilters: { statusFilter: 'all', aspectFilter: 'all', creationFilter: 'all' } },
    setStatusFilter: vi.fn(), setAspectFilter: vi.fn(), setCreationFilter: vi.fn(),
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
vi.mock('./Logo', () => ({ LogoWithText: () => <div />, Logo: () => <div />, default: () => <div /> }));
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

describe('ProjectManager tab switch scroll (T13490)', () => {
  it('opening Finished from a scrolled tab lands at the top of the page scroller', () => {
    window.history.replaceState(null, '', '/home/games');
    const { container } = render(
      <div data-testid="scroller" style={{ overflowY: 'auto' }}>
        <AppStateProvider value={{ unseenReelsCount: 0, exportingProject: null }}>
          <ProjectManager
            projects={[]} loading={false} games={[]} gamesLoading={false}
            onSelectProject={vi.fn()} onRefreshProjects={vi.fn()} onDeleteProject={vi.fn()}
            onAnnotateWithFile={vi.fn()} onLoadGame={vi.fn()} onDeleteGame={vi.fn()} onFetchGames={vi.fn()}
          />
        </AppStateProvider>
      </div>
    );
    const scroller = container.querySelector('[data-testid="scroller"]');
    scroller.scrollTop = 600;
    fireEvent.click(screen.getByTestId('home-tab-published'));
    expect(screen.getByTestId('published-tab-panel').dataset.active).toBe('true');
    expect(scroller.scrollTop).toBe(0);
  });
});
