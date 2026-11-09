import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppStateProvider } from '../contexts';

// T14980: changing the home tab is its own navigation gesture -- editorStore's updatePath
// never sees it (the mode stays 'project-manager'), so ProjectManager's setActiveTab must
// write the resume point itself.

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
  useGuidanceSettings: () => ({ coachEnabled: true }),
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

vi.mock('./Logo', () => ({ LogoWithText: () => <div />, Logo: () => <div />, default: () => <div /> }));
vi.mock('./CreditBalance', () => ({ CreditBalance: () => <div /> }));
vi.mock('./InstallButton', () => ({ InstallButton: () => <div /> }));
vi.mock('./SignInButton', () => ({ SignInButton: () => <div />, default: () => <div /> }));
vi.mock('./ProfileSportButton', () => ({ ProfileSportButton: () => <div />, default: () => <div /> }));
vi.mock('./ProfileDropdown', () => ({ ProfileDropdown: () => <div /> }));
vi.mock('./GameTile', () => ({ GameTile: () => <div data-testid="game-tile" /> }));
vi.mock('./UploadingGameTile', () => ({ UploadingGameTile: () => <div data-testid="uploading-tile" /> }));
vi.mock('./ReferenceGameCard', () => ({ ReferenceGameCard: () => <div data-testid="reference-card" /> }));
vi.mock('./DraftTile', () => ({
  DraftTile: (props) => <div data-testid="draft-tile" data-project-id={props.project?.id}>{props.project?.name}</div>,
  default: () => <div />,
}));
vi.mock('./PublishedReelsPanel', () => ({
  PublishedReelsPanel: (props) => <div data-testid="published-tab-panel" data-active={String(!!props.active)} />,
}));

const h = vi.hoisted(() => ({ writeResumePoint: vi.fn() }));
vi.mock('../utils/resumePoint', () => ({ writeResumePoint: h.writeResumePoint }));

import { ProjectManager } from './ProjectManager';

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

const clipsTab = () => screen.getByRole('button', { name: /^Plays/i });
const publishedTab = () => screen.getByRole('button', { name: /^Highlights/i });

describe('T14980: home tab switch writes the resume point', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/home');
    h.writeResumePoint.mockClear();
  });

  it('writes the point with the tab and its canonical path when the Clips tab is clicked', () => {
    renderManager({ projects: [], games: [] });
    fireEvent.click(clipsTab());
    expect(h.writeResumePoint).toHaveBeenCalledWith({
      path: '/home/reels',
      mode: 'project-manager',
      tab: 'projects',
    });
  });

  it('writes the point for the Published tab too', () => {
    renderManager({ projects: [], games: [] });
    fireEvent.click(publishedTab());
    expect(h.writeResumePoint).toHaveBeenCalledWith({
      path: '/home/published',
      mode: 'project-manager',
      tab: 'published',
    });
  });
});
