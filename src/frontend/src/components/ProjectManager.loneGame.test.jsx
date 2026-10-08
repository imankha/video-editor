import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppStateProvider } from '../contexts';

// T12220: a lone game is centred (not left-aligned under a centred header, qa-37).
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

vi.mock('../hooks/useClipUpload', () => ({
  useClipUpload: () => ({
    uploadClips: vi.fn(),
    progressByFile: {},
    isUploading: false,
    error: null,
  }),
}));

vi.mock('./shared/Toast', () => ({
  toast: {
    success: vi.fn(), error: vi.fn(), info: vi.fn(),
    warning: vi.fn(), loading: vi.fn(), dismiss: vi.fn(),
  },
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
  const state = { requireAuth: (cb) => cb(), isAuthenticated: true };
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

import {
  ProjectManager,
  GAMES_GRID_CONTAINER_CLASS,
  GAMES_TILE_GRID_BY_COLUMNS,
} from './ProjectManager';
import { useGalleryStore } from '../stores/galleryStore';

const APP_STATE = { unseenReelsCount: 0, exportingProject: null };

const game = (id) => ({
  id, name: `g${id}`, game_date: '2026-05-10', created_at: '2026-06-01 10:00:00',
  clip_count: 2, is_reference: false,
});

function renderGames(games) {
  window.history.replaceState(null, '', '/home/games');
  return render(
    <AppStateProvider value={APP_STATE}>
      <ProjectManager
        projects={[]}
        loading={false}
        games={games}
        gamesLoading={false}
        onSelectProject={vi.fn()}
        onSelectProjectWithMode={vi.fn()}
        onRefreshProjects={vi.fn()}
        onDeleteProject={vi.fn()}
        onAnnotateWithFile={vi.fn()}
        onLoadGame={vi.fn()}
        onDeleteGame={vi.fn()}
        onFetchGames={vi.fn()}
      />
    </AppStateProvider>
  );
}

describe('T12220 lone game is centred', () => {
  it('T12220:C2 a single game section is max-w-xl mx-auto and skips the 8rem rail', () => {
    const { container } = renderGames([game(1)]);
    const section = container.querySelector('section[data-group-kind]');
    expect(section.className).toContain('max-w-xl');
    expect(section.className).toContain('mx-auto');
    expect(section.className).not.toContain('8rem');
  });

  it('two games keep the rail layout', () => {
    const { container } = renderGames([game(1), game(2)]);
    const sections = [...container.querySelectorAll('section[data-group-kind]')];
    sections.forEach((s) => expect(s.className).toContain('8rem'));
  });
});
