import { render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppStateProvider } from '../contexts';
import { GUIDE } from '../config/displayNames';

// T16030: App.jsx mounts SharedVideoOverlay as a SIBLING of Home for a signed-in viewer
// (same shape as the T12800 DraftReelPreview sibling), so Home's own guide (shade + card +
// pulse) must go null while that overlay sits on top, or it bleeds through onto the shared
// reel a brand-new viewer opened.

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

describe('Home guide while the shared-video overlay sits on top (T16030)', () => {
  beforeEach(() => { useGalleryStore.setState({ isOpen: false, count: 0, unwatchedCount: 0 }); });

  it('Games tab shows no guide while sharedOverlayOpen', () => {
    renderManager({ sharedOverlayOpen: true });
    expect(document.body.textContent).not.toContain(GUIDE.home.gamesEmpty.title);
  });

  it('Games tab shows its normal guide once sharedOverlayOpen clears (Close)', () => {
    renderManager({ sharedOverlayOpen: false });
    expect(document.body.textContent).toContain(GUIDE.home.gamesEmpty.title);
  });
});
