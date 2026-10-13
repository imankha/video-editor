import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppStateProvider } from '../contexts';

// T11230 (was ProjectManager.fourTabIA.test.jsx): the home IA is now THREE peer
// tabs -- Games / Clips / Published. The In Progress Reels tab (`inProgressReels`,
// /home/reels-in-progress) and its Create-reel builder were removed with the Reels
// building surfaces (single-clip-editor epic). Legacy multi-clip drafts stay
// reachable in the Clips tab's "Legacy reels" group (T11220), NOT under a Reels tab.
//
// Red-then-green anchors (fail on pre-T11230 ProjectManager, pass after):
//   - no button whose accessible name starts with "Reels" renders (tab is gone)
//   - a deep link to the retired /home/reels-in-progress lands on Home (R6: any
//     unsupported link goes Home via tabFromPath -> null -> default), never on a
//     reels panel
//   - legacy multi-clip drafts (is_auto_created === false) still render, in the
//     Clips tab's legacy-reel-drafts group

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
  useGuidanceSettings: () => ({ coachEnabled: globalThis.__coachEnabled }),
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
vi.mock('./Logo', () => ({ LogoWithText: () => <div />, Logo: () => <div />, default: () => <div /> }));
vi.mock('./CreditBalance', () => ({ CreditBalance: () => <div /> }));
vi.mock('./InstallButton', () => ({ InstallButton: () => <div /> }));
vi.mock('./SignInButton', () => ({ SignInButton: () => <div />, default: () => <div /> }));
vi.mock('./ProfileSportButton', () => ({ ProfileSportButton: () => <div />, default: () => <div /> }));
vi.mock('./ProfileDropdown', () => ({ ProfileDropdown: () => <div /> }));
vi.mock('./GameTile', () => ({ GameTile: () => <div data-testid="game-tile" /> }));
vi.mock('./UploadingGameTile', () => ({ UploadingGameTile: () => <div data-testid="uploading-tile" /> }));
vi.mock('./ReferenceGameCard', () => ({ ReferenceGameCard: () => <div data-testid="reference-card" /> }));
// DraftTile echoes the project id/name so tests can assert WHICH drafts rendered
// (single-clip drafts in the Clips gallery, legacy multi-clip drafts in the
// Legacy reels group).
vi.mock('./DraftTile', () => ({
  DraftTile: (props) => (
    <div data-testid="draft-tile" data-project-id={props.project?.id}>
      {props.project?.name}
    </div>
  ),
  default: () => <div />,
}));
vi.mock('./PublishedReelsPanel', () => ({
  PublishedReelsPanel: (props) => (
    <div data-testid="published-tab-panel" data-active={String(!!props.active)} />
  ),
}));

import { ProjectManager } from './ProjectManager';
import { useGalleryStore } from '../stores/galleryStore';
import { EMPTY_TAB_GUIDE } from '../config/emptyStates';

const APP_STATE = { unseenReelsCount: 2, exportingProject: null };

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

// Label-first accessible-name lookups (DOM-order landmine: name reads
// "{label}{count}", never digit-first).
const gamesTab = () => screen.getByRole('button', { name: /^Games/i });
const clipsTab = () => screen.getByRole('button', { name: /^Clips/i });
const publishedTab = () => screen.getByRole('button', { name: /^Finished/i });



describe('T12620:C7 Home pulses follow the Guidance switch', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/home');
    useGalleryStore.setState({ isOpen: false, count: 5, unwatchedCount: 2 });
  });
  const games = [{ id: 1, name: 'g', clip_count: 2, status: 'ready', created_at: '2026-09-20T00:00:00Z' }];

  it('Finished tab pulses with Guidance on and stops with it off', () => {
    globalThis.__coachEnabled = true;
    const { unmount } = renderManager({ games });
    expect(publishedTab().className).toContain('coach-target-pulse');
    unmount();
    globalThis.__coachEnabled = false;
    renderManager({ games });
    expect(publishedTab().className).not.toContain('coach-target-pulse');
  });
});
