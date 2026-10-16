import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppStateProvider } from '../contexts';

// T12800: DraftReelPreview (the Finished viewer) is a fullscreen overlay mounted as a
// SIBLING of ProjectsScreen (App.jsx), not nested inside it, so GuideScope's "innermost
// wins" never reached it. Home's own pulse (e.g. home-first-game) stayed CSS-active the
// whole time the viewer was open -- invisible behind the opaque overlay in a real
// browser, but it's exactly the kind of guide the sweep (e2e/guide-no-overlap.spec.js)
// flagged as buried, and it's wasted work either way. Home's guide now stands down
// while the viewer owns the screen, the same as it already does for the upload modal.

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
  const state = { currentProfileId: 'p1', profiles: [{ id: 'p1', sport: 'soccer' }], switchProfile: vi.fn() };
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
import { useReelPreviewStore } from '../stores/reelPreviewStore';

const GAME = { id: 1, name: 'at Legends', clip_count: 3, status: 'ready', created_at: '2026-10-01T00:00:00Z' };

function renderManager(props = {}) {
  window.history.replaceState(null, '', '/home');
  return render(
    <AppStateProvider value={{ unseenReelsCount: 0, exportingProject: null }}>
      <ProjectManager projects={[]} loading={false} games={[GAME]} gamesLoading={false}
        onSelectProject={vi.fn()} onRefreshProjects={vi.fn()} onDeleteProject={vi.fn()}
        onAnnotateWithFile={vi.fn()} onLoadGame={vi.fn()} onDeleteGame={vi.fn()} onFetchGames={vi.fn()}
        {...props} />
    </AppStateProvider>
  );
}

describe('Home guide stands down while the Finished viewer (DraftReelPreview) is open (T12800)', () => {
  beforeEach(() => {
    useGalleryStore.setState({ isOpen: false, count: 0, unwatchedCount: 0 });
    useReelPreviewStore.setState({ payload: null });
  });

  it('pulses the first game when the viewer is closed', () => {
    renderManager();
    expect(screen.getByTestId('home-first-game').className).toContain('coach-target-pulse');
  });

  it('pulses nothing once the viewer opens over Home', () => {
    useReelPreviewStore.setState({ payload: { projectId: 9, finalVideoId: 1, name: 'Clip', openMode: 'project_manager' } });
    renderManager();
    expect(document.querySelectorAll('.coach-target-pulse').length).toBe(0);
  });

  it('resumes pulsing once the viewer closes', () => {
    useReelPreviewStore.setState({ payload: { projectId: 9, finalVideoId: 1, name: 'Clip', openMode: 'project_manager' } });
    const { rerender } = renderManager();
    expect(document.querySelectorAll('.coach-target-pulse').length).toBe(0);
    useReelPreviewStore.setState({ payload: null });
    rerender(
      <AppStateProvider value={{ unseenReelsCount: 0, exportingProject: null }}>
        <ProjectManager projects={[]} loading={false} games={[GAME]} gamesLoading={false}
          onSelectProject={vi.fn()} onRefreshProjects={vi.fn()} onDeleteProject={vi.fn()}
          onAnnotateWithFile={vi.fn()} onLoadGame={vi.fn()} onDeleteGame={vi.fn()} onFetchGames={vi.fn()} />
      </AppStateProvider>
    );
    expect(screen.getByTestId('home-first-game').className).toContain('coach-target-pulse');
  });
});
