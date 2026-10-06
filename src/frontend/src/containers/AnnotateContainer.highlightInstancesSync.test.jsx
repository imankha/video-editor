import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

/**
 * T11910: "create then UI == reloaded UI". A response that changes a play's
 * highlights must replace region.highlightInstances with the SERVER's list
 * (same mapper as the load path), and an export finishing while Annotate stays
 * mounted must refresh just that play. Before the fix the list stayed [] until
 * reload, so the screen rendered the legacy single-button layout right after
 * creating and the instance list after reload.
 *
 * Drives the REAL AnnotateContainer hook with apiFetch mocked (harness mirrors
 * AnnotateContainer.forceNewFields.test.jsx).
 */

vi.mock('../utils/apiFetch', () => ({ default: vi.fn() }));

vi.mock('../modes/annotate', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useAnnotateState: (...args) => ({
      ...actual.useAnnotateState(...args),
      annotateGameId: 42,
      annotateVideoMetadata: { duration: 120 },
    }),
  };
});

import apiFetch from '../utils/apiFetch';
import { AnnotateContainer } from './AnnotateContainer';
import { useAuthStore } from '../stores/authStore';
import { useQuestStore } from '../stores/questStore';
import { useExportStore } from '../stores/exportStore';
import { useToastStore } from '../components/shared/Toast';

const flush = () => new Promise((r) => setTimeout(r, 0));

function baseProps(overrides = {}) {
  return {
    videoRef: { current: null },
    currentTime: 10,
    duration: 120,
    isPlaying: false,
    togglePlay: vi.fn(),
    pause: vi.fn(),
    stepForward: vi.fn(),
    stepBackward: vi.fn(),
    seekBackward: vi.fn(),
    restart: vi.fn(),
    seek: vi.fn(),
    getGame: vi.fn(),
    loadGame: vi.fn(),
    fetchProjects: vi.fn(),
    setEditorMode: vi.fn(),
    onOpenReelInFocus: vi.fn(),
    ...overrides,
  };
}

const authOriginal = useAuthStore.getState();
const questOriginal = useQuestStore.getState();
const exportOriginal = useExportStore.getState();

const instance = (projectId, aspect, extra = {}) => ({
  project_id: projectId,
  aspect_ratio: aspect,
  highlight_ordinal: 1,
  has_working_video: false,
  has_final_video: false,
  is_published: false,
  archived_at: null,
  reel_source_start_time: 1,
  reel_source_end_time: 6,
  ...extra,
});

const camel = (projectId, aspectRatio, extra = {}) => ({
  projectId,
  aspectRatio,
  highlightOrdinal: 1,
  hasWorkingVideo: false,
  hasFinalVideo: false,
  isPublished: false,
  archivedAt: null,
  reelSourceStartTime: 1,
  reelSourceEndTime: 6,
  ...extra,
});

async function markPlay(result) {
  await act(async () => { result.current.handleAddClipFromButton(); });
  await act(async () => { await flush(); });
  return result.current.clipRegions[0].id;
}

function respond(handler) {
  apiFetch.mockImplementation(async (url, opts) => {
    const body = handler(url, opts ?? {});
    return { ok: true, status: 200, json: async () => body };
  });
}

describe('AnnotateContainer: highlight list is server-synced (T11910)', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    useAuthStore.setState({ isAuthenticated: true });
    useQuestStore.setState({ recordAchievement: vi.fn(), fetchProgress: vi.fn().mockResolvedValue(undefined) });
    window.matchMedia = (query) => ({
      matches: false, media: query, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    });
    useToastStore.setState({ toasts: [] });
  });

  afterEach(() => {
    useAuthStore.setState(authOriginal, true);
    useQuestStore.setState(questOriginal, true);
    useExportStore.setState(exportOriginal, true);
    useToastStore.setState({ toasts: [] });
    vi.restoreAllMocks();
  });

  it('a new play starts with an empty list (never undefined)', async () => {
    respond(() => ({ raw_clip_id: 7, filename: '', project_created: false, project_id: null, highlight_instances: [] }));
    const { result } = renderHook(() => AnnotateContainer(baseProps()));
    await markPlay(result);
    expect(result.current.clipRegions[0].highlightInstances).toEqual([]);
  });

  it('create-project response replaces the list with the server list (same shape as a reload)', async () => {
    const server = [instance(99, '16:9')];
    respond((url, opts) => (opts.method === 'PUT'
      ? { success: true, project_created: true, project_id: 99, highlight_instances: server }
      : { raw_clip_id: 7, filename: '', project_created: false, project_id: null, highlight_instances: [] }));
    const { result } = renderHook(() => AnnotateContainer(baseProps()));
    const id = await markPlay(result);

    await act(async () => {
      await result.current.updateClipRegion(id, { createProject: true, forceNew: true, aspectRatio: '16:9', silent: true });
    });
    await act(async () => { await flush(); });

    expect(result.current.clipRegions[0].highlightInstances).toEqual([camel(99, '16:9')]);
  });

  it('a second create REPLACES the list with the server list (never appends locally)', async () => {
    let n = 0;
    respond((url, opts) => {
      if (opts.method !== 'PUT') return { raw_clip_id: 7, filename: '', project_created: false, project_id: null, highlight_instances: [] };
      n += 1;
      return n === 1
        ? { success: true, project_created: true, project_id: 99, highlight_instances: [instance(99, '9:16')] }
        : { success: true, project_created: true, project_id: 100,
            highlight_instances: [instance(99, '9:16'), instance(100, '16:9')] };
    });
    const { result } = renderHook(() => AnnotateContainer(baseProps()));
    const id = await markPlay(result);
    for (const aspectRatio of ['9:16', '16:9']) {
      await act(async () => {
        await result.current.updateClipRegion(id, { createProject: true, forceNew: true, aspectRatio, silent: true });
      });
      await act(async () => { await flush(); });
    }
    expect(result.current.clipRegions[0].highlightInstances.map((i) => i.projectId)).toEqual([99, 100]);
  });

  it('first save of an unsaved play with an orientation sends aspect_ratio on POST /save and syncs the list', async () => {
    // The mark-play POST does not land a raw_clip_id, so the play has no rawClipId
    // yet: the create gesture goes through the SAVE path, not PUT. Landscape must
    // work as the FIRST highlight there (aspect_ratio on the save body).
    const saveBodies = [];
    respond((url, opts) => {
      if (opts.method === 'POST') {
        saveBodies.push(JSON.parse(opts.body));
        return saveBodies.length === 1
          ? { filename: '', project_created: false, project_id: null, highlight_instances: [] }
          : { raw_clip_id: 7, filename: '', project_created: true, project_id: 99,
              highlight_instances: [instance(99, '16:9')] };
      }
      throw new Error(`unexpected ${opts.method} ${url}`);
    });
    const { result } = renderHook(() => AnnotateContainer(baseProps()));
    const id = await markPlay(result);
    expect(result.current.clipRegions[0].rawClipId ?? null).toBeNull();

    await act(async () => {
      await result.current.updateClipRegion(id, { createProject: true, forceNew: true, aspectRatio: '16:9', silent: true });
    });
    await act(async () => { await flush(); });

    const createBody = saveBodies.find((b) => b.create_project === true);
    expect(createBody, 'a POST /api/clips/raw/save body with create_project').toBeTruthy();
    expect(createBody).toHaveProperty('aspect_ratio', '16:9');
    expect(createBody).not.toHaveProperty('aspectRatio');
    expect(result.current.clipRegions[0].highlightInstances).toEqual([camel(99, '16:9')]);
  });

  it('a create response WITHOUT highlight_instances logs loudly and leaves the list alone', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    respond((url, opts) => (opts.method === 'PUT'
      ? { success: true, project_created: true, project_id: 99 }
      : { raw_clip_id: 7, filename: '', project_created: false, project_id: null, highlight_instances: [] }));
    const { result } = renderHook(() => AnnotateContainer(baseProps()));
    const id = await markPlay(result);

    await act(async () => {
      await result.current.updateClipRegion(id, { createProject: true, forceNew: true, silent: true });
    });
    await act(async () => { await flush(); });

    expect(result.current.clipRegions[0].highlightInstances).toEqual([]);
    expect(errSpy.mock.calls.some(([m]) => String(m).includes('T11910'))).toBe(true);
  });

  it('an export completing for one of the play\'s projects refreshes ONLY that play from the server', async () => {
    let refreshed = false;
    respond((url, opts) => {
      if (String(url).endsWith('/highlight-instances')) {
        refreshed = true;
        return { highlight_instances: [instance(99, '9:16', { has_working_video: true })] };
      }
      if (opts.method === 'PUT') {
        return { success: true, project_created: true, project_id: 99, highlight_instances: [instance(99, '9:16')] };
      }
      return { raw_clip_id: 7, filename: '', project_created: false, project_id: null, highlight_instances: [] };
    });
    const { result } = renderHook(() => AnnotateContainer(baseProps()));
    const id = await markPlay(result);
    await act(async () => {
      await result.current.updateClipRegion(id, { createProject: true, forceNew: true, silent: true });
    });
    await act(async () => { await flush(); });
    expect(result.current.clipRegions[0].highlightInstances[0].hasWorkingVideo).toBe(false);

    await act(async () => {
      useExportStore.setState({ activeExports: { e1: { exportId: 'e1', projectId: 99, type: 'framing', status: 'processing' } } });
    });
    await act(async () => {
      useExportStore.setState({ activeExports: { e1: { exportId: 'e1', projectId: 99, type: 'framing', status: 'complete' } } });
    });
    await act(async () => { await flush(); });

    expect(refreshed).toBe(true);
    expect(result.current.clipRegions[0].highlightInstances[0].hasWorkingVideo).toBe(true);
  });

  it('the export-complete refresh is read-only: it issues a GET and never a PUT/POST', async () => {
    respond((url, opts) => {
      if (String(url).endsWith('/highlight-instances')) return { highlight_instances: [instance(99, '9:16')] };
      if (opts.method === 'PUT') {
        return { success: true, project_created: true, project_id: 99, highlight_instances: [instance(99, '9:16')] };
      }
      return { raw_clip_id: 7, filename: '', project_created: false, project_id: null, highlight_instances: [] };
    });
    const { result } = renderHook(() => AnnotateContainer(baseProps()));
    const id = await markPlay(result);
    await act(async () => {
      await result.current.updateClipRegion(id, { createProject: true, forceNew: true, silent: true });
    });
    await act(async () => { await flush(); });
    const writesBefore = apiFetch.mock.calls.filter(([, o]) => ['PUT', 'POST', 'PATCH', 'DELETE'].includes(o?.method)).length;

    await act(async () => {
      useExportStore.setState({ activeExports: { e3: { exportId: 'e3', projectId: 99, type: 'framing', status: 'processing' } } });
    });
    await act(async () => {
      useExportStore.setState({ activeExports: { e3: { exportId: 'e3', projectId: 99, type: 'framing', status: 'complete' } } });
    });
    await act(async () => { await flush(); });

    const writesAfter = apiFetch.mock.calls.filter(([, o]) => ['PUT', 'POST', 'PATCH', 'DELETE'].includes(o?.method)).length;
    expect(apiFetch.mock.calls.some(([u]) => String(u).endsWith('/highlight-instances'))).toBe(true);
    expect(writesAfter).toBe(writesBefore);
  });

  it('an export completing for an unrelated project triggers no refresh', async () => {
    let refreshed = false;
    respond((url) => {
      if (String(url).endsWith('/highlight-instances')) refreshed = true;
      return { raw_clip_id: 7, filename: '', project_created: false, project_id: null, highlight_instances: [] };
    });
    const { result } = renderHook(() => AnnotateContainer(baseProps()));
    await markPlay(result);
    await act(async () => {
      useExportStore.setState({ activeExports: { e2: { exportId: 'e2', projectId: 555, type: 'framing', status: 'processing' } } });
    });
    await act(async () => {
      useExportStore.setState({ activeExports: { e2: { exportId: 'e2', projectId: 555, type: 'framing', status: 'complete' } } });
    });
    await act(async () => { await flush(); });
    expect(refreshed).toBe(false);
  });
});
