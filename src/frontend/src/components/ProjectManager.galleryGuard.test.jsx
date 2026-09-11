import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppStateProvider } from '../contexts';

// T9660 — full-width-gallery + batch-finishing PRESERVATION guard.
//
// Andrew praised (1) the full-width responsive gallery and (2) being able to keep
// marking/finishing plays without a first-time wizard interrupting. The first-clip
// work in this group (T9580/T9440/T9390) risks regressing exactly those via a
// narrow fixed content column or a forced onboarding modal. These are guards, not
// new UI: they fail CLOSED if a future task narrows the gallery, hides direct clip
// upload, or drops the persistent non-blocking finish-clips entry.
//
// The real-geometry reflow (cards wrap, no horizontal overflow) is asserted live in
// e2e/cta-visibility.spec.js; jsdom can't measure layout, so here we pin the width
// class + reflow map (the source of that geometry) and the entry-point structure.

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

function renderOnClipsTab(props = {}) {
  window.history.replaceState(null, '', '/home/reels');
  return render(
    <AppStateProvider value={APP_STATE}>
      <ProjectManager
        projects={[]}
        loading={false}
        games={[]}
        gamesLoading={false}
        onSelectProject={vi.fn()}
        onSelectProjectWithMode={vi.fn()}
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

const A_CLIP = { id: 7, name: 'A saved play', game_ids: [], is_auto_created: true };

beforeEach(() => {
  window.history.replaceState(null, '', '/home/reels');
  useGalleryStore.setState({ isOpen: false });
});

describe('T9660 — full-width gallery width class (no narrow fixed column)', () => {
  // The one class both the Games poster grid and the Clips carousel gallery render
  // inside. A first-clip task replacing it with a narrow reading-column (max-w-md /
  // max-w-2xl / a fixed px width) is the exact regression to catch.
  it('follows the viewport (w-full + max-w-6xl, widening to max-w-7xl) — never a narrow cap', () => {
    expect(GAMES_GRID_CONTAINER_CLASS).toContain('w-full');
    expect(GAMES_GRID_CONTAINER_CLASS).toContain('max-w-6xl');
    expect(GAMES_GRID_CONTAINER_CLASS).toContain('2xl:max-w-7xl');
    // No narrow content-column cap and no fixed pixel width.
    expect(GAMES_GRID_CONTAINER_CLASS).not.toMatch(/max-w-(xs|sm|md|lg|xl|2xl|3xl|4xl|5xl)\b/);
    expect(GAMES_GRID_CONTAINER_CLASS).not.toMatch(/\bw-\[\d/);
  });

  it('reflows responsively on mobile — cards wrap, they do not shrink into a fixed column', () => {
    // Mobile 2-up, tablet 3-up, desktop 4-up: the grid REFLOWS by breakpoint rather
    // than clamping the whole gallery to one narrow column.
    expect(GAMES_TILE_GRID_BY_COLUMNS[2]).toContain('grid-cols-2');
    expect(GAMES_TILE_GRID_BY_COLUMNS[3]).toContain('sm:grid-cols-3');
    expect(GAMES_TILE_GRID_BY_COLUMNS[4]).toContain('lg:grid-cols-4');
    for (const cls of Object.values(GAMES_TILE_GRID_BY_COLUMNS)) {
      expect(cls).toContain('grid-cols-2'); // mobile floor is always a wrapping grid
    }
  });

  it('renders the populated Clips gallery inside the full-width class, not a narrow column', () => {
    const { container } = renderOnClipsTab({ projects: [A_CLIP] });
    // The clips gallery content area is present at the full-width class...
    expect(container.querySelector('.max-w-6xl')).toBeTruthy();
    // ...and no narrow reading-column cap has crept into the rendered tree.
    expect(container.querySelector('.max-w-md, .max-w-sm, .max-w-lg')).toBeNull();
  });
});

describe('T9660 — direct clip upload stays visible (not gated behind a wizard)', () => {
  it('empty Clips tab exposes the direct clip-upload entry as a real button', () => {
    renderOnClipsTab(); // no clips, no games -> inline EmptyTabGuide
    const target = document.querySelector('[data-tutorial-target="clips-add-video"]');
    expect(target).toBeTruthy();
    expect(target.tagName).toBe('BUTTON'); // keyboard-reachable, never a hover-only reveal
  });

  it('populated Clips tab keeps the direct clip-upload entry visible', async () => {
    renderOnClipsTab({ projects: [A_CLIP] });
    const uploadClip = await screen.findByRole('button', { name: 'Upload clip' });
    expect(uploadClip.getAttribute('data-tutorial-target')).toBe('clips-add-video');
  });
});

describe('T9660 — persistent, non-blocking finish-clips entry', () => {
  it('surfaces the resume-finishing entry as a plain button whenever an in-progress clip exists', async () => {
    renderOnClipsTab({ projects: [A_CLIP] });
    const entry = await screen.findByTestId('continue-finishing-clip');
    expect(entry.tagName).toBe('BUTTON'); // inline affordance, not a modal step
  });

  it('does NOT impose a blocking first-time wizard on load (no dialog intercepts the user)', () => {
    renderOnClipsTab({ projects: [A_CLIP] });
    // The clip-upload consequence notice / AttachVideoModal only opens on an explicit
    // click; nothing blocks the experienced user the instant the home shell paints.
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});

// The finish-clips entry must also survive the empty account (a brand-new user has
// no wizard forced on them — the empty guide is inline, never a dialog).
describe('T9660 — empty account is guided inline, never gated by a modal wizard', () => {
  it('empty Clips tab renders an inline guide, not a blocking dialog', () => {
    renderOnClipsTab();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    // The inline guide's direct-upload path is still present.
    expect(document.querySelector('[data-tutorial-target="clips-add-video"]')).toBeTruthy();
  });
});
