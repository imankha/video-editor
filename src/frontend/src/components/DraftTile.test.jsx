import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

// jsdom lacks matchMedia (useIsMobile) — stub desktop.
vi.mock('../hooks/useIsMobile', () => ({
  useIsMobile: () => false,
  useIsLandscape: () => false,
}));

// DraftTile reads several stores; stub the minimal surface it touches.
vi.mock('../utils/apiFetch', () => ({ default: vi.fn() }));
vi.mock('../stores/projectsStore', () => {
  const state = { fetchProjects: vi.fn(), renameProject: vi.fn() };
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

function renderTile(overrides = {}) {
  return render(
    <DraftTile
      project={{ ...baseProject, ...overrides }}
      onSelect={vi.fn()}
      onSelectWithMode={vi.fn()}
      onDelete={vi.fn()}
    />
  );
}

describe('DraftTile (T5672)', () => {
  it('renders a lazy poster img pointing at the T5671 endpoint', () => {
    const { container } = renderTile();
    const img = container.querySelector('img[loading="lazy"]');
    expect(img).toBeTruthy();
    expect(img.getAttribute('src')).toMatch(/\/api\/projects\/7\/poster\.jpg$/);
  });

  it('shows a skeleton while the poster loads, then hides it on load', () => {
    const { container } = renderTile();
    // animate-pulse skeleton present initially
    expect(container.querySelector('.animate-pulse')).toBeTruthy();
    fireEvent.load(container.querySelector('img'));
    expect(container.querySelector('.animate-pulse')).toBeNull();
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
});
