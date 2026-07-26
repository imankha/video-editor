import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

// jsdom lacks matchMedia (useIsMobile) — stub desktop.
vi.mock('../hooks/useIsMobile', () => ({
  useIsMobile: () => false,
  useIsLandscape: () => false,
}));

// Stub MediaPlayer: the preview tests care about WHERE the modal mounts (portal)
// and that it unmounts on close — not the player internals (which pull in
// window.matchMedia via VideoControls, absent in jsdom). The stub echoes its src
// so we can locate the mounted player.
vi.mock('./MediaPlayer', () => ({
  MediaPlayer: ({ src }) => <video data-testid="preview-video" src={src} />,
}));

// DraftTile reads several stores; stub the minimal surface it touches.
vi.mock('../utils/apiFetch', () => ({ default: vi.fn() }));
vi.mock('../stores/projectsStore', () => {
  const state = { fetchProjects: vi.fn(), renameProject: vi.fn(), selectedProjectId: null };
  const useProjectsStore = (sel) => sel(state);
  useProjectsStore.getState = () => state;
  return { useProjectsStore };
});
vi.mock('../stores/syncStore', () => {
  const state = { isOffline: false };
  const useSyncStore = (sel) => sel(state);
  useSyncStore.getState = () => state;
  return { useSyncStore };
});
vi.mock('../stores/exportStore', () => {
  const state = { activeExports: {} };
  const useExportStore = (sel) => sel(state);
  useExportStore.getState = () => state;
  return { useExportStore };
});
vi.mock('../stores/galleryStore', () => {
  const api = { fetchCount: vi.fn(), notifyCollectionsChanged: vi.fn(), open: vi.fn() };
  const useGalleryStore = () => api;
  useGalleryStore.getState = () => api;
  return { useGalleryStore };
});
vi.mock('../stores/questStore', () => {
  const api = { recordAchievement: vi.fn() };
  const useQuestStore = () => api;
  useQuestStore.getState = () => api;
  return { useQuestStore };
});

import { DraftTile } from './DraftTile';
import { useProjectsStore } from '../stores/projectsStore';

const baseProject = {
  id: 7,
  name: 'Brilliant Dribble',
  aspect_ratio: '9:16',
  clip_count: 1,
  clips_in_progress: 1,
  clips_exported: 0,
  has_working_video: false,
  has_final_video: false,
  is_published: false,
  is_auto_created: false,
  game_ids: [],
};

function renderTile(overrides = {}, handlers = {}) {
  const onSelect = handlers.onSelect || vi.fn();
  const onSelectWithMode = handlers.onSelectWithMode || vi.fn();
  const result = render(
    <DraftTile
      project={{ ...baseProject, ...overrides }}
      onSelect={onSelect}
      onSelectWithMode={onSelectWithMode}
      onDelete={vi.fn()}
    />
  );
  return { ...result, onSelect, onSelectWithMode };
}

describe('DraftTile (T5672)', () => {
  afterEach(() => {
    useProjectsStore.getState().selectedProjectId = null;
  });
  it('renders a lazy poster img pointing at the T5671 endpoint', () => {
    const { container } = renderTile();
    const img = container.querySelector('img[loading="lazy"]');
    expect(img).toBeTruthy();
    expect(img.getAttribute('src')).toMatch(/\/api\/projects\/7\/poster\.jpg$/);
  });

  it('shows a shimmer skeleton while the poster loads, then hides it on load', () => {
    const { container } = renderTile();
    // shimmer skeleton present initially (not the flat gray / branded fallback)
    expect(container.querySelector('.skeleton-shimmer')).toBeTruthy();
    fireEvent.load(container.querySelector('img'));
    expect(container.querySelector('.skeleton-shimmer')).toBeNull();
  });

  it('fades the poster in on load (opacity-0 while loading -> opacity-100 loaded)', () => {
    const { container } = renderTile();
    const img = container.querySelector('img');
    expect(img.className).toMatch(/transition-opacity/);
    expect(img.className).toMatch(/opacity-0/);
    fireEvent.load(img);
    expect(container.querySelector('img').className).toMatch(/opacity-100/);
  });

  it('shows the branded fallback ONLY after a real poster error, never before', () => {
    const { container } = renderTile();
    // While loading: shimmer, no branded fallback gradient
    expect(container.querySelector('.skeleton-shimmer')).toBeTruthy();
    expect(container.querySelector('.from-cyan-900')).toBeNull();
    fireEvent.error(container.querySelector('img'));
    // After error: branded fallback gradient, no shimmer, no img
    expect(container.querySelector('.from-cyan-900')).toBeTruthy();
    expect(container.querySelector('.skeleton-shimmer')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
  });

  it('renders the branded reel-name fallback (no img) when the poster 404s', () => {
    const { container } = renderTile();
    fireEvent.error(container.querySelector('img'));
    // img is gone; the reel name still shows (fallback overlay + scrim both carry it)
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getAllByText('Brilliant Dribble').length).toBeGreaterThan(0);
  });

  it('shows a status chip reflecting framing-in-progress', () => {
    renderTile({ clips_in_progress: 1 });
    expect(screen.getByText('Framing')).toBeTruthy();
  });

  it('shows a Done status chip for a completed reel', () => {
    renderTile({ has_final_video: true, is_published: true });
    expect(screen.getByText('Done')).toBeTruthy();
  });

  it('renders the ready-to-publish badge (Move to My Reels) only when complete and unpublished', () => {
    renderTile({ has_final_video: true, final_video_id: 99, is_published: false });
    expect(screen.getByRole('button', { name: /move to/i })).toBeTruthy();
  });

  it('has no ready-to-publish badge once the reel is published', () => {
    renderTile({ has_final_video: true, final_video_id: 99, is_published: true });
    expect(screen.queryByRole('button', { name: /move to/i })).toBeNull();
  });

  it('renders the game-time overlay when the draft carries a game start time', () => {
    // formatGameClock expects a seconds value; 705s -> 11'45"
    renderTile({ clip_game_start_time: 705 });
    expect(screen.getByText(/11'45/)).toBeTruthy();
  });

  it('renders a clip-count chip when the draft has more than 1 clip', () => {
    renderTile({ clip_count: 3 });
    const chip = screen.getByText('3').closest('span');
    expect(chip).toBeTruthy();
    expect(chip.getAttribute('title')).toBe('Contains 3 clips');
    expect(chip.getAttribute('aria-label')).toBe('Contains 3 clips');
    // Layers icon should be present (rendered via Lucide)
    expect(chip.querySelector('svg')).toBeTruthy();
  });

  it('does not show a clip-count chip for a single-clip draft', () => {
    renderTile({ clip_count: 1 });
    expect(screen.queryByText('1')).toBeNull();
    expect(screen.queryByTitle(/Contains \d+ clips/)).toBeNull();
  });

  it('renders a portrait 9:16 tile shape by default', () => {
    const { container } = renderTile({ aspect_ratio: '9:16' });
    const tile = container.querySelector('[data-testid="project-card"]');
    expect(tile.className).toMatch(/aspect-\[9\/16\]/);
    expect(tile.className).not.toMatch(/aspect-video/);
  });

  it('renders a landscape 16:9 tile shape (mirrors ReelTile, not letterboxed into portrait)', () => {
    const { container } = renderTile({ aspect_ratio: '16:9' });
    const tile = container.querySelector('[data-testid="project-card"]');
    expect(tile.className).toMatch(/aspect-video/);
    expect(tile.className).not.toMatch(/aspect-\[9\/16\]/);
  });

  // Item 3 — selected/active + currently-loaded accent ring
  it('is keyboard-focusable and exposes a focus-visible ring (item 3)', () => {
    const { container } = renderTile();
    const tile = container.querySelector('[data-testid="project-card"]');
    expect(tile.getAttribute('tabindex')).toBe('0');
    expect(tile.getAttribute('role')).toBe('button');
    expect(tile.className).toMatch(/focus-visible:ring-2/);
  });

  it('gives the CURRENTLY-LOADED draft a persistent accent ring (item 3)', () => {
    useProjectsStore.getState().selectedProjectId = baseProject.id;
    const { container } = renderTile();
    const tile = container.querySelector('[data-testid="project-card"]');
    expect(tile.getAttribute('aria-current')).toBe('true');
    expect(tile.className).toMatch(/ring-cyan-400/);
    expect(tile.className).toMatch(/border-cyan-400/);
  });

  it('does not accent a draft that is not the loaded project (item 3)', () => {
    useProjectsStore.getState().selectedProjectId = 999; // a different project
    const { container } = renderTile();
    const tile = container.querySelector('[data-testid="project-card"]');
    expect(tile.getAttribute('aria-current')).toBeNull();
    expect(tile.className).toMatch(/border-gray-700/);
  });

  it('activates via Enter key like a button (item 3)', () => {
    // A not-yet-started draft opens via onSelect (the default earliest stage).
    const onSelect = vi.fn();
    const { container } = renderTile(
      { clips_in_progress: 0, clips_exported: 0 },
      { onSelect }
    );
    const tile = container.querySelector('[data-testid="project-card"]');
    fireEvent.keyDown(tile, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  // Item 6 — click opens the furthest stage reached
  it('routes an overlay-started draft (working video) to Overlay on click (item 6)', () => {
    const onSelectWithMode = vi.fn();
    const { container } = renderTile(
      { has_working_video: true, clips_in_progress: 0 },
      { onSelectWithMode }
    );
    fireEvent.click(container.querySelector('[data-testid="project-card"]'));
    expect(onSelectWithMode).toHaveBeenCalledWith({ mode: 'overlay' });
  });

  it('routes a framing-started draft (no working video) to Framing clip 0 on click (item 6)', () => {
    const onSelectWithMode = vi.fn();
    const { container } = renderTile(
      { has_working_video: false, clips_in_progress: 1 },
      { onSelectWithMode }
    );
    fireEvent.click(container.querySelector('[data-testid="project-card"]'));
    expect(onSelectWithMode).toHaveBeenCalledWith({ mode: 'framing', clipIndex: 0 });
  });

  it('routes a not-yet-started draft to the default open (earliest stage) on click (item 6)', () => {
    const onSelect = vi.fn();
    const onSelectWithMode = vi.fn();
    const { container } = renderTile(
      { has_working_video: false, clips_in_progress: 0, clips_exported: 0 },
      { onSelect, onSelectWithMode }
    );
    fireEvent.click(container.querySelector('[data-testid="project-card"]'));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelectWithMode).not.toHaveBeenCalled();
  });

  // T5900 — preview modal must PORTAL out of the tile subtree. The tile applies a
  // hover transform/filter, which makes it the containing block for any fixed
  // descendant; a modal rendered inline would size its video against the tile box
  // (video overflows the panel, defect A) and leave the purple scrub bar burned on
  // the tile (defect B). Portaling to document.body is the mechanism that prevents
  // both — asserted here in a layout-free way (real geometry is the Playwright QA
  // spec T5900-reel-preview-overflow.qa.spec.js).
  describe('T5900 preview modal containment', () => {
    const completed = { has_final_video: true, final_video_id: 99, is_published: false };

    it('renders the preview modal OUTSIDE the tile subtree (portaled to body), not inline', () => {
      const { container } = renderTile(completed);
      fireEvent.click(screen.getByTitle('Preview video'));
      const card = container.querySelector('[data-testid="project-card"]');
      const player = screen.getByTestId('preview-video');
      expect(player.getAttribute('src')).toMatch(/\/api\/downloads\/99\/stream$/);
      // The player is in the document but NOT a descendant of the tile card.
      expect(document.body.contains(player)).toBe(true);
      expect(card.contains(player)).toBe(false);
    });

    it('portals the modal out of the tile for a LANDSCAPE source too (aspect-independent)', () => {
      const { container } = renderTile({ ...completed, aspect_ratio: '16:9' });
      fireEvent.click(screen.getByTitle('Preview video'));
      const card = container.querySelector('[data-testid="project-card"]');
      expect(card.contains(screen.getByTestId('preview-video'))).toBe(false);
    });

    it('unmounts the modal (no player, no scrub chrome) after close via the X button', () => {
      renderTile(completed);
      fireEvent.click(screen.getByTitle('Preview video'));
      expect(screen.queryByTestId('preview-video')).toBeTruthy();
      // Close button is the only iconOnly ghost button inside the portaled modal.
      const closeBtn = screen.getAllByRole('button').find((b) => b.closest('.fixed'));
      fireEvent.click(closeBtn);
      expect(screen.queryByTestId('preview-video')).toBeNull();
      // No leftover fixed modal chrome anywhere in the document.
      expect(document.querySelector('.fixed.inset-4')).toBeNull();
    });
  });
});
