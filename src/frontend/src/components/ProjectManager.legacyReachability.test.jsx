import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppStateProvider } from '../contexts';

// T11220: legacy multi-clip reel drafts (is_auto_created === false) must stay
// reachable from the In Progress Clips tab, INDEPENDENT of the In Progress Reels
// tab (which T11230 removes next). Before this task those drafts rendered ONLY on
// the Reels tab; the Clips tab filtered them out (clipDrafts = is_auto_created)
// and showed the empty guide for a legacy-only account. This suite drives the
// Clips-tab path only and never touches the Reels tab, so it proves reachability
// that does not depend on the Reels tab existing.

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
// Echo the project id so we can assert WHICH drafts rendered.
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
        onSelectProjectWithMode={vi.fn()}
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

const clipsTab = () => screen.getByRole('button', { name: /^Clips/i });
const legacyGroup = () => screen.queryByTestId('legacy-reel-drafts');

const multiclipDraft = (id, name = `Legacy Reel ${id}`) => ({
  id, name, game_ids: [], is_auto_created: false, clip_count: 2,
});
const singleclipDraft = (id, name = `Clip ${id}`) => ({
  id, name, game_ids: [], is_auto_created: true, clip_count: 1,
});

describe('T11220: legacy multi-clip drafts are reachable from the Clips tab', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/home');
    useGalleryStore.setState({ isOpen: false });
  });

  it('an account with ONLY a legacy multi-clip draft shows it on Clips (not the empty guide)', () => {
    renderManager({ projects: [multiclipDraft(1, 'My Old Reel')] });
    fireEvent.click(clipsTab());

    const group = legacyGroup();
    expect(group).toBeTruthy();
    const tile = within(group).getByTestId('draft-tile');
    expect(tile.dataset.projectId).toBe('1');
    expect(within(group).getByText('My Old Reel')).toBeTruthy();
    // The dead-end empty guide must NOT show — the draft is reachable here.
    expect(screen.queryByText(EMPTY_TAB_GUIDE.clips.headline)).toBeNull();
  });

  it('shows BOTH single-clip drafts and the legacy group when both exist', () => {
    renderManager({ projects: [singleclipDraft(2, 'Fresh Clip'), multiclipDraft(3, 'Old Reel')] });
    fireEvent.click(clipsTab());

    // Single-clip draft renders (in the normal clip gallery). Its name also
    // appears in the "Continue where you left off" recents rail, so assert the
    // clip's draft-tile carries its project id rather than a bare text match.
    const clipTiles = screen.getAllByTestId('draft-tile');
    expect(clipTiles.some((t) => t.dataset.projectId === '2')).toBe(true);
    // Legacy multi-clip draft renders in the labelled legacy group.
    const group = legacyGroup();
    expect(group).toBeTruthy();
    expect(within(group).getByText('Old Reel')).toBeTruthy();
    expect(within(group).getByTestId('draft-tile').dataset.projectId).toBe('3');
  });

  it('does NOT render the legacy group when there are no legacy drafts', () => {
    renderManager({ projects: [singleclipDraft(2)] });
    fireEvent.click(clipsTab());
    expect(legacyGroup()).toBeNull();
  });

  it('a /home/reels (Clips) refresh for a legacy-only account is NOT bounced to Games', () => {
    // The one-time initial settle used to send a zero-clip-draft account to Games;
    // a legacy-only account must stay on Clips so its drafts stay visible.
    renderManager({ projects: [multiclipDraft(4)] }, '/home/reels');
    expect(legacyGroup()).toBeTruthy();
  });
});
