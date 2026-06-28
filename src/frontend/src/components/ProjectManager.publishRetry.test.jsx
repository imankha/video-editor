import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// jsdom lacks matchMedia (useIsMobile) — stub it.
vi.mock('../hooks/useIsMobile', () => ({
  useIsMobile: () => false,
  useIsLandscape: () => false,
}));

// apiFetch / store fns are referenced inside hoisted vi.mock factories, so they
// must be created with vi.hoisted (which runs before the factories).
const { apiFetchMock, fetchProjectsMock, renameProjectMock } = vi.hoisted(() => ({
  apiFetchMock: vi.fn(),
  fetchProjectsMock: vi.fn(),
  renameProjectMock: vi.fn(),
}));

vi.mock('../utils/apiFetch', () => ({ default: (...a) => apiFetchMock(...a) }));

// Stores ProjectCard reads. fetchProjects is the refetch that removes the card;
// the durability fix must NOT call it on a 503 sync_failed.
vi.mock('../stores/projectsStore', () => {
  const state = { fetchProjects: fetchProjectsMock, renameProject: renameProjectMock };
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
  const api = {
    fetchCount: vi.fn(),
    notifyCollectionsChanged: vi.fn(),
    open: vi.fn(),
  };
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

import { ProjectCard } from './ProjectManager';

const baseProject = {
  id: 42,
  name: 'Brilliant Dribble',
  has_final_video: true,
  is_published: false,        // -> isReadyToPublish: shows "Move to My Reels"
  final_video_id: 99,
  has_working_video: false,
  clips_in_progress: 0,
  clips_exported: 1,
  game_ids: [],
};

function renderCard(overrides = {}) {
  render(
    <ProjectCard
      project={{ ...baseProject, ...overrides }}
      onSelect={vi.fn()}
      onSelectWithMode={vi.fn()}
      onDelete={vi.fn()}
    />
  );
}

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe('ProjectCard publish — durable sync 503 (T4050)', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    fetchProjectsMock.mockReset();
  });

  it('on 503 sync_failed: keeps the card, does NOT refetch, and shows Retry', async () => {
    apiFetchMock.mockResolvedValueOnce(
      jsonResponse(503, { code: 'sync_failed', retryable: true, detail: 'Could not save to the cloud.' })
    );

    renderCard();
    fireEvent.click(screen.getByText(/Move to/i));

    // Retry affordance appears...
    const retry = await screen.findByRole('button', { name: 'Retry' });
    expect(retry).toBeTruthy();
    // ...and the card was NOT optimistically removed (no refetch fired).
    expect(fetchProjectsMock).not.toHaveBeenCalled();
  });

  it('Retry re-invokes publish; a subsequent success clears Retry and refetches', async () => {
    apiFetchMock
      .mockResolvedValueOnce(
        jsonResponse(503, { code: 'sync_failed', retryable: true })
      )
      .mockResolvedValueOnce(
        jsonResponse(200, { success: true, final_video_id: 99, archived: true })
      );

    renderCard();
    fireEvent.click(screen.getByText(/Move to/i));

    const retry = await screen.findByRole('button', { name: 'Retry' });
    expect(fetchProjectsMock).not.toHaveBeenCalled();

    fireEvent.click(retry);

    // Second call succeeds -> Retry disappears and the card refetches (removal).
    await waitFor(() => expect(fetchProjectsMock).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(apiFetchMock).toHaveBeenCalledTimes(2);
  });
});
