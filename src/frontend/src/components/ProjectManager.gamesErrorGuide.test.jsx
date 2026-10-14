import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppStateProvider } from '../contexts';
import { GUIDE } from '../config/displayNames';

// T12790: a failed games fetch left every Home tab without a guide sentence
// (homeGuide was null whenever gamesError was set), so the error panel had no
// recovery line and the Clips / Finished tabs, which do not depend on games,
// went silent too.

class MockIntersectionObserver { observe() {} unobserve() {} disconnect() {} }
globalThis.IntersectionObserver = MockIntersectionObserver;
vi.mock('../hooks/useIsMobile', () => ({ useIsMobile: () => false, useIsCoarsePointer: () => false, useIsLandscape: () => false }));
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
vi.mock('./PublishedReelsPanel', () => ({ PublishedReelsPanel: () => <div data-testid="published-tab-panel" /> }));

import { ProjectManager } from './ProjectManager';
import { useGalleryStore } from '../stores/galleryStore';

function renderManager(props = {}) {
  window.history.replaceState(null, '', '/home');
  return render(
    <AppStateProvider value={{ unseenReelsCount: 0, exportingProject: null }}>
      <ProjectManager projects={[]} loading={false} games={[]} gamesLoading={false}
        onSelectProject={vi.fn()} onRefreshProjects={vi.fn()} onDeleteProject={vi.fn()}
        onAnnotateWithFile={vi.fn()} onLoadGame={vi.fn()} onDeleteGame={vi.fn()} onFetchGames={vi.fn()}
        {...props} />
    </AppStateProvider>
  );
}

describe('Home guide when the games list fails to load (T12790)', () => {
  beforeEach(() => { useGalleryStore.setState({ isOpen: false, count: 0, unwatchedCount: 0 }); });

  it('Games tab says to retry and pulses Retry', () => {
    renderManager({ gamesError: 'Server error 500' });
    expect(document.body.textContent).toContain(GUIDE.home.gamesError.title);
    expect(screen.getByTestId('home-games-retry').className).toContain('coach-target-pulse');
  });

  it('Clips tab keeps its own guide', () => {
    renderManager({ gamesError: 'Server error 500' });
    fireEvent.click(screen.getByRole('button', { name: /^Clips/i }));
    expect(document.body.textContent).toContain(GUIDE.home.clipsEmpty.title);
  });
});
