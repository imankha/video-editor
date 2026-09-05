import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppStateProvider } from '../contexts';

// T8555: locks in the FOUR-tab IA (Games / In Progress Clips / In Progress
// Reels / Published) that replaces T8545's three-tab bar (Games / Clips /
// Highlights). Written PRE-IMPLEMENTATION (Stage 3) against the approved
// design (T8555-design.md) + ui-spec (T8555-ui-spec.md) -- these tests are
// expected to FAIL until the implementation:
//   - adds `inProgressReels` (`/home/reels-in-progress`) and `published`
//     (`/home/published`) entries to TAB_PATHS
//   - renames SECTION_NAMES.CLIPS -> "In Progress Clips", HIGHLIGHTS ->
//     "In Progress Reels", adds PUBLISHED -> "Published"
//   - moves the in-progress `highlightDrafts` block out of DownloadsPanel
//     into an inline ProjectManager branch on the new `inProgressReels` tab
//   - renames DownloadsPanel -> PublishedReelsPanel, gated on
//     activeTab === 'published', testid `published-tab-panel`
//   - relocates the `unseenReelsCount` badge from the old Highlights tab to
//     the new Published tab; wires `highlightDrafts.length` to the new
//     In Progress Reels tab badge
//
// This file does NOT replace ProjectManager.homeTabDefaults.test.jsx's
// existing three-way-tab describe block -- that rewrite (plus the 46-file
// e2e sweep) is Implementation's job per T8555-design.md Sec 4. This is a
// focused, additive unit suite scoped to the new tab-bar contract.

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
// DraftTile is used both by the (frozen) Clips tab AND the new inline
// In Progress Reels branch -- echo the project id/name so tests can assert
// WHICH drafts rendered where.
vi.mock('./DraftTile', () => ({
  DraftTile: (props) => (
    <div data-testid="draft-tile" data-project-id={props.project?.id}>
      {props.project?.name}
    </div>
  ),
  default: () => <div />,
}));
// PublishedReelsPanel (was DownloadsPanel) is the always-mounted Published tab
// body -- stub it so its heavy hook/store deps don't leak into this tab-bar test.
vi.mock('./PublishedReelsPanel', () => ({
  PublishedReelsPanel: (props) => (
    <div data-testid="published-tab-panel" data-active={String(!!props.active)} />
  ),
}));

import { ProjectManager } from './ProjectManager';
import { useGalleryStore } from '../stores/galleryStore';

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
        onCreateProject={vi.fn()}
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
// "{label}{count}", never digit-first). Anchor on the label prefix per the
// ui-spec's own locator guidance (Sec 4).
const gamesTab = () => screen.getByRole('button', { name: /^Games/i });
const clipsTab = () => screen.getByRole('button', { name: /^In Progress Clips/i });
const inProgressReelsTab = () => screen.getByRole('button', { name: /^In Progress Reels/i });
const publishedTab = () => screen.getByRole('button', { name: /^Published/i });

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

describe('T8555: four peer tabs render with exact labels', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/home');
    useGalleryStore.setState({ isOpen: false });
  });

  it('renders Games, In Progress Clips, In Progress Reels, and Published as four peer tabs', () => {
    renderManager();

    expect(gamesTab()).toBeTruthy();
    expect(clipsTab()).toBeTruthy();
    expect(inProgressReelsTab()).toBeTruthy();
    expect(publishedTab()).toBeTruthy();
  });

  it('the retired "Highlights" label no longer appears as a tab', () => {
    renderManager();

    // Old T8545 label must be gone -- greppability AC ("zero remaining
    // references to a Highlights *tab*"). A loose /^Highlights/ match would
    // wrongly pass once renamed to "In Progress Reels" (different prefix), so
    // this assertion is meaningful evidence, not a tautology.
    expect(screen.queryByRole('button', { name: /^Highlights/i })).toBeNull();
  });
});

describe('T8555: In Progress Reels tab shows ONLY unpublished multiclip drafts', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/home');
    useGalleryStore.setState({ isOpen: false });
  });

  it('shows highlightDrafts (is_auto_created === false) and the Build New Reel button, no published content', () => {
    renderManager({
      projects: [multiclipDraft(1, 'My Multiclip Draft'), singleclipDraft(2, 'My Single Clip')],
    });

    fireEvent.click(inProgressReelsTab());

    // Only the multiclip draft renders here -- the single-clip draft belongs
    // to the (frozen) In Progress Clips tab, not this one.
    const tile = screen.getByTestId('draft-tile');
    expect(tile.dataset.projectId).toBe('1');
    expect(screen.queryByText('My Single Clip')).toBeNull();

    // The assembly button lives inline on this tab now (moved out of
    // DownloadsPanel per the design's mechanical-move decision). T8780
    // renamed it to "Build New Reel" -- "Highlight Reel" is reserved for
    // published reels elsewhere in the app (displayNames.js).
    expect(screen.getByRole('button', { name: 'Build New Reel' })).toBeTruthy();

    // No published-gallery content (ConfidenceBanner / CollectionsTab /
    // published-tab-panel testid) leaks into this tab's body. (dataset.active,
    // matching this file's convention -- jest-dom's toHaveAttribute is not
    // imported here.)
    expect(screen.queryByTestId('published-tab-panel')?.dataset.active).not.toBe('true');
  });

  it('empty state shows "No reels in progress" + Build New Reel copy, button below the message', () => {
    renderManager({ projects: [singleclipDraft(2)] });

    fireEvent.click(inProgressReelsTab());

    const message = screen.getByText(/No reels in progress/i);
    const button = screen.getByRole('button', { name: /Build New Reel/i });
    expect(message).toBeTruthy();
    expect(button).toBeTruthy();
    // T8780: empty-state message resolves into its own action below it,
    // matching the Published tab's empty-state order.
    expect(message.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByTestId('draft-tile')).toBeNull();
  });
});

describe('T8555: Published tab renders the published gallery panel', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/home');
    useGalleryStore.setState({ isOpen: false });
  });

  it('clicking Published mounts the panel active with testid published-tab-panel', () => {
    renderManager();

    fireEvent.click(publishedTab());

    const panel = screen.getByTestId('published-tab-panel');
    expect(panel.dataset.active).toBe('true');
  });

  it('a deep link to /home/published lands directly on the Published tab', () => {
    renderManager({}, '/home/published');

    expect(screen.getByTestId('published-tab-panel').dataset.active).toBe('true');
  });

  it('publish-landing effect (galleryStore.isOpen) retargets to Published, not the retired Highlights id', async () => {
    renderManager();
    expect(screen.getByTestId('published-tab-panel').dataset.active).toBe('false');

    useGalleryStore.getState().open();

    await waitFor(() => {
      expect(screen.getByTestId('published-tab-panel').dataset.active).toBe('true');
    });
    // Fire-once signal consumed, same T8400/T8470 contract as before.
    expect(useGalleryStore.getState().isOpen).toBe(false);
  });
});

describe('T8555: badge counts', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/home');
    useGalleryStore.setState({ isOpen: false });
  });

  it('In Progress Reels badge shows highlightDrafts.length, not the published unseen count', () => {
    renderManager({
      projects: [multiclipDraft(1), multiclipDraft(2), singleclipDraft(3)],
      unseenReelsCount: 9,
    });

    // Two multiclip drafts -> badge count 2 (single-clip draft excluded).
    expect(within(inProgressReelsTab()).getAllByText('2').length).toBeGreaterThan(0);
    // The unseen-published count must NOT leak onto this tab's badge.
    expect(within(inProgressReelsTab()).queryAllByText('9').length).toBe(0);
  });

  it('Published badge shows unseenReelsCount (relocated from the old Highlights badge)', () => {
    renderManager({ unseenReelsCount: 5 });

    expect(within(publishedTab()).getAllByText('5').length).toBeGreaterThan(0);
  });
});
