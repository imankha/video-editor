import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AppStateProvider } from '../contexts';

// T11800 fallback: a Focus session with no Annotate origin lands on the Clips tab with
// the new draft scrolled into view and ringed ONCE (consume-once, T8990). Harness copied
// from ProjectManager.legacyReachability.test.jsx (DraftTile is mocked to echo its id; the
// ring itself is DraftTile's read of galleryStore.clipsRingProjectId, covered below by
// asserting the store state ProjectManager drives).

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


const singleclipDraft = (id) => ({ id, name: `Clip ${id}`, game_ids: [], is_auto_created: true, clip_count: 1 });
const legacyDraft = (id) => ({ id, name: `Legacy ${id}`, game_ids: [], is_auto_created: false, clip_count: 2 });

describe('T11800: Clips-tab ring for the draft a Focus session just produced', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Element.prototype.scrollIntoView = vi.fn();
    sessionStorage.clear();
    sessionStorage.setItem('projectManagerTab', 'projects');
    useGalleryStore.setState({ isOpen: false, clipsRingTarget: 5, clipsRingProjectId: null });
  });
  afterEach(() => {
    vi.useRealTimers();
    sessionStorage.clear();
    useGalleryStore.setState({ clipsRingTarget: null, clipsRingProjectId: null });
  });

  it('lights the ring on the target tile, scrolls to it, clears it after 2.5s, and never re-consumes on a remount', async () => {
    const first = renderManager({ projects: [singleclipDraft(5)] }, '/home');
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });

    expect(useGalleryStore.getState().clipsRingProjectId).toBe(5);
    expect(useGalleryStore.getState().clipsRingTarget).toBeNull();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();

    await act(async () => { await vi.advanceTimersByTimeAsync(2600); });
    expect(useGalleryStore.getState().clipsRingProjectId).toBeNull();

    first.unmount();
    sessionStorage.setItem('projectManagerTab', 'projects');
    renderManager({ projects: [singleclipDraft(5)] }, '/home');
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    expect(useGalleryStore.getState().clipsRingProjectId).toBeNull();
  });

  it('rings a draft that lives in the Legacy reels group too', async () => {
    useGalleryStore.setState({ clipsRingTarget: 8 });
    renderManager({ projects: [legacyDraft(8)] }, '/home');
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    expect(useGalleryStore.getState().clipsRingProjectId).toBe(8);
  });

  it('drops (does not keep) a target that matches no rendered tile', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    useGalleryStore.setState({ clipsRingTarget: 999 });
    renderManager({ projects: [singleclipDraft(5)] }, '/home');
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    expect(useGalleryStore.getState().clipsRingProjectId).toBeNull();
    expect(useGalleryStore.getState().clipsRingTarget).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
