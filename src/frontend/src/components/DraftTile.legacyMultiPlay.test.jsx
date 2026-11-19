import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// jsdom lacks matchMedia. DraftTile's reveal mechanism runs through the REAL
// useIsCoarsePointer hook (T5910), which reads `(pointer: coarse)` — so we stub
// matchMedia and let each test flip the pointer type. This exercises the actual
// width-vs-input-type decision instead of mocking the hook away (a width-only or
// hook-mocked test cannot catch the narrow-desktop-fine-pointer bug).
let coarsePointer = false;
beforeEach(() => {
  coarsePointer = false;
  window.matchMedia = (query) => ({
    matches: query.includes('pointer: coarse') ? coarsePointer : false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });
});

// T8535: DraftTile no longer mounts its own preview player — Preview calls the
// shared openFinishedReel helper, which opens the consolidated DraftReelPreview
// surface (mounted once in App.jsx). Stub the helper so these tests assert the
// CALL, not a player implementation this component no longer owns.
vi.mock('../utils/finishedReelNav', () => ({ openFinishedReel: vi.fn() }));

// T11220: spy on the toast surface so the legacy-multi-clip re-frame refusal is
// assertable. DraftTile only uses `toast`; the other exports are unused here.
vi.mock('./shared/Toast', () => ({
  toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() },
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
// T7940: DraftTile appends the current profile's id to the poster URL so a
// URL-keyed cache can't cross-serve same-numbered drafts across accounts.
vi.mock('../stores/profileStore', () => ({
  useCurrentProfile: () => ({ id: 'p1', sport: 'soccer' }),
}));
// T10180: the kebab gains a Download item, wired via useDownloads.downloadFile
// (item 5, design doc §3.5) -- instantiated directly in DraftTile.
const { downloadsApi } = vi.hoisted(() => ({
  downloadsApi: { downloadFile: vi.fn().mockResolvedValue(undefined), downloadingId: null },
}));
vi.mock('../hooks/useDownloads', () => ({
  useDownloads: () => downloadsApi,
  default: () => downloadsApi,
}));

import { DraftTile } from './DraftTile';
import { openFinishedReel } from '../utils/finishedReelNav';

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

import { RESULT_SURFACE, LIBRARY_ACTIONS } from '../config/displayNames';

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

const renamePencil = () => screen.queryByRole('button', { name: LIBRARY_ACTIONS.RENAME_CLIP });

// T17840: an old highlight made from several plays (clip_count > 1) is frozen. Its
// card must say so at a glance and must not look like an editable draft.
describe('T17840 old multi-play highlight card', () => {
  it('C1: says it is not supported, with no "In progress" badge and no pencil', () => {
    renderTile({ clip_count: 5 });
    expect(screen.getByText('Not supported')).toBeTruthy();
    expect(screen.getByTitle(/^Highlights made from several plays are no longer supported for editing\./)).toBeTruthy();
    expect(screen.queryByText('In progress')).toBeNull();
    expect(renamePencil()).toBeNull();
  });

  it('C1: a multi-play highlight with a working video also hides "In progress"', () => {
    renderTile({ clip_count: 3, has_working_video: true });
    expect(screen.queryByText('In progress')).toBeNull();
    expect(screen.getByText('Not supported')).toBeTruthy();
  });

  it('C3: a finished multi-play highlight keeps Watch', () => {
    renderTile({ clip_count: 3, has_final_video: true, is_published: true, final_video_id: 42 });
    fireEvent.click(screen.getByTitle(RESULT_SURFACE.WATCH_HIGHLIGHT));
    expect(openFinishedReel).toHaveBeenCalledTimes(1);
  });

  it('C3: a single-play draft keeps its "In progress" badge and pencil exactly as before', () => {
    renderTile({ clip_count: 1 });
    expect(screen.getByText('In progress')).toBeTruthy();
    expect(renamePencil()).toBeTruthy();
    expect(screen.queryByText('Not supported')).toBeNull();
  });
});
