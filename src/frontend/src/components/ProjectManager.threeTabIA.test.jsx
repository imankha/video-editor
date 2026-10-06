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
const queryReelsTab = () => screen.queryByRole('button', { name: /^Reels/i });

const multiclipDraft = (id, name = `Highlight Draft ${id}`) => ({
  id,
  name,
  game_ids: [],
  is_auto_created: false,
});
const singleclipDraft = (id, name = `Clip Draft ${id}`) => ({
  id,
  name,
  game_ids: [],
  is_auto_created: true,
});

describe('T11230: three peer tabs render, no Reels tab', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/home');
    useGalleryStore.setState({ isOpen: false });
  });

  it('renders Games, Clips, and Published as the three peer tabs', () => {
    renderManager();

    expect(gamesTab()).toBeTruthy();
    expect(clipsTab()).toBeTruthy();
    expect(publishedTab()).toBeTruthy();
  });

  it('no In Progress Reels tab exists (removed with the Reels building surfaces)', () => {
    renderManager({ projects: [multiclipDraft(1)] });

    // A button whose accessible name starts with "Reels" was the tab. It must be
    // gone -- this fails on pre-T11230 code (the tab still renders) and is the
    // core red-then-green anchor for the deletion.
    expect(queryReelsTab()).toBeNull();
  });

  it('the retired "Highlights" label also does not appear as a tab', () => {
    renderManager();
    expect(screen.queryByRole('button', { name: /^Highlights/i })).toBeNull();
  });
});

describe('T11230: retired /home/reels-in-progress deep link lands on Home', () => {
  beforeEach(() => {
    useGalleryStore.setState({ isOpen: false });
  });

  it('a deep link to the retired Reels tab renders Home, not a reels panel', () => {
    // R6: any unsupported link goes Home. tabFromPath('/home/reels-in-progress')
    // is now null, so the account with clip drafts settles on the Clips gallery
    // (the bare-/home default), never an in-progress-reels panel.
    renderManager({ projects: [singleclipDraft(2, 'Landed Clip')] }, '/home/reels-in-progress');

    // No reels tab, and no retired reels panel testid.
    expect(queryReelsTab()).toBeNull();
    expect(screen.queryByTestId('in-progress-reels-tab-panel')).toBeNull();
    // Home is reachable: the three tabs render and the clip draft is shown (it
    // appears both in the resume rail and the Clips gallery, hence getAllByText).
    expect(gamesTab()).toBeTruthy();
    expect(clipsTab()).toBeTruthy();
    expect(publishedTab()).toBeTruthy();
    expect(screen.getAllByText('Landed Clip').length).toBeGreaterThan(0);
  });

  it('a legacy-only account (only multi-clip drafts) at the retired link lands on Home too', () => {
    renderManager({ projects: [multiclipDraft(1)] }, '/home/reels-in-progress');
    expect(queryReelsTab()).toBeNull();
    expect(gamesTab()).toBeTruthy();
    expect(publishedTab()).toBeTruthy();
  });
});

describe('T11230: legacy multi-clip drafts stay reachable in the Clips tab', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/home');
    useGalleryStore.setState({ isOpen: false });
  });

  it('renders multi-clip drafts in the Legacy reels group, not under a Reels tab', () => {
    renderManager({
      projects: [multiclipDraft(1, 'My Multiclip Draft'), singleclipDraft(2, 'My Single Clip')],
    });

    fireEvent.click(clipsTab());

    // The legacy group (T11220) is the reachability path now the Reels tab is gone.
    const legacyGroup = screen.getByTestId('legacy-reel-drafts');
    expect(within(legacyGroup).getByText('My Multiclip Draft')).toBeTruthy();
    // The single-clip draft renders too (in the main clip gallery).
    expect(screen.getByText('My Single Clip')).toBeTruthy();
  });
});

describe('T11230: Published tab renders the published gallery panel', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/home');
    useGalleryStore.setState({ isOpen: false });
  });

  it('clicking Published mounts the panel active with testid published-tab-panel', () => {
    renderManager({ projects: [singleclipDraft(9)] });

    fireEvent.click(publishedTab());

    const panel = screen.getByTestId('published-tab-panel');
    expect(panel.dataset.active).toBe('true');
  });

  it('a deep link to /home/published lands directly on the Published tab', () => {
    renderManager({}, '/home/published');

    expect(screen.getByTestId('published-tab-panel').dataset.active).toBe('true');
  });

  it('publish-landing effect (galleryStore.isOpen) retargets to Published', async () => {
    renderManager();
    expect(screen.getByTestId('published-tab-panel').dataset.active).toBe('false');

    useGalleryStore.getState().open();

    await waitFor(() => {
      expect(screen.getByTestId('published-tab-panel').dataset.active).toBe('true');
    });
    expect(useGalleryStore.getState().isOpen).toBe(false);
  });
});

// T8990: the lone-game coaching cell + the Clips tutorial-target invariant
// (unaffected by the Reels removal -- kept verbatim from the four-tab suite).
const oneGame = (id = 'g1') => ({
  id,
  name: `Game ${id}`,
  created_at: '2026-09-01T00:00:00Z',
  game_date: '2026-09-01',
});

describe('T8990: Games partial-guide cell', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/home/games');
    useGalleryStore.setState({ isOpen: false });
  });

  const partialHeadline = 'Cut your first play';

  it('renders the partial guide beside the tile at exactly one game', () => {
    renderManager({ games: [oneGame()] }, '/home/games');
    expect(screen.getByText(partialHeadline)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open game' })).toBeTruthy();
    expect(screen.getByTestId('game-tile')).toBeTruthy();
  });

  it('the Open game CTA loads that game', () => {
    const onLoadGame = vi.fn();
    renderManager({ games: [oneGame('gX')], onLoadGame }, '/home/games');
    fireEvent.click(screen.getByRole('button', { name: 'Open game' }));
    expect(onLoadGame).toHaveBeenCalledWith('gX');
  });

  it('does NOT render at zero games (the empty variant shows instead)', () => {
    renderManager({ games: [] }, '/home/games');
    expect(screen.queryByText(partialHeadline)).toBeNull();
    expect(screen.getByText(EMPTY_TAB_GUIDE.games.headline)).toBeTruthy();
  });

  it('does NOT render at two games (first row is full)', () => {
    renderManager({ games: [oneGame('g1'), oneGame('g2')] }, '/home/games');
    expect(screen.queryByText(partialHeadline)).toBeNull();
  });

  it('is hidden while an upload is in flight', () => {
    renderManager({ games: [oneGame()], uploads: [{ id: 'u1', status: 'uploading', fileName: 'x.mp4' }] }, '/home/games');
    expect(screen.queryByText(partialHeadline)).toBeNull();
    expect(screen.getByTestId('uploading-tile')).toBeTruthy();
  });

  it('is hidden while a resumable pending upload exists', () => {
    renderManager({ games: [oneGame()], pendingUploads: [{ session_id: 's1', original_filename: 'x.mp4' }] }, '/home/games');
    expect(screen.queryByText(partialHeadline)).toBeNull();
  });

  it('does NOT render when the lone game is a cross-profile reference (CTA would misroute)', () => {
    renderManager({ games: [{ ...oneGame('gRef'), is_reference: true }] }, '/home/games');
    expect(screen.getByTestId('reference-card')).toBeTruthy();
    expect(screen.queryByText(partialHeadline)).toBeNull();
  });

  it('does NOT render for a lone game that already has saved plays (clip_count > 0)', () => {
    renderManager({ games: [{ ...oneGame('gDone'), clip_count: 2 }] }, '/home/games');
    expect(screen.getByTestId('game-tile')).toBeTruthy();
    expect(screen.queryByText(partialHeadline)).toBeNull();
  });

  it('still renders for a lone game with no saved plays yet (clip_count === 0)', () => {
    renderManager({ games: [{ ...oneGame('gNew'), clip_count: 0 }] }, '/home/games');
    expect(screen.getByText(partialHeadline)).toBeTruthy();
  });
});

describe('T8990: clips-add-video tutorial target stays unique (T8380 invariant)', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/home/reels');
    useGalleryStore.setState({ isOpen: false });
  });

  const targets = () => document.querySelectorAll('[data-tutorial-target="clips-add-video"]');

  it('empty Clips state: exactly one target (the empty guide Add Video button)', () => {
    renderManager({ projects: [] }, '/home/reels');
    fireEvent.click(clipsTab());
    expect(targets().length).toBe(1);
  });

  it('non-empty Clips state: exactly one target (the action row), partial filler adds none', () => {
    renderManager({ projects: [singleclipDraft(2)] }, '/home/reels');
    fireEvent.click(clipsTab());
    expect(targets().length).toBe(1);
  });
});

describe('T11230: badge counts + always-reachable tabs', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/home');
    useGalleryStore.setState({ isOpen: false });
  });

  it('Published badge shows unseenReelsCount', () => {
    renderManager({ unseenReelsCount: 5 });
    expect(within(publishedTab()).getAllByText('5').length).toBeGreaterThan(0);
  });

  it('Clips badge shows the single-clip draft count (multi-clip drafts excluded)', () => {
    renderManager({ projects: [singleclipDraft(1), singleclipDraft(2), multiclipDraft(3)] });
    // Two single-clip drafts -> badge 2; the multi-clip draft is not counted here.
    expect(within(clipsTab()).getAllByText('2').length).toBeGreaterThan(0);
  });

  it('no clips at all: Games, Clips and Published are all enabled', () => {
    renderManager({ projects: [], games: [] });
    expect(gamesTab().disabled).toBe(false);
    expect(clipsTab().disabled).toBe(false);
    expect(publishedTab().disabled).toBe(false);
  });
});
