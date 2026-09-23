import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// T11040 regression: a persistence gesture must never report success without
// issuing a write.
//
// Prod incident (imankh@gmail.com, 2026-09-22): a fully annotated game reached
// the backend with ZERO clips. Every Mark Play built its region in memory and
// returned `{ saveOk: true }` without a request, because the create/update paths
// read the closed-over `annotateGameId` state instead of the always-current ref.
// Frame Now / Frame Later reach the backend through the same update path, so
// they became silent no-ops in the same sessions.
//
// Here `annotateGameId` is pinned to null (the broken-closure condition) while
// the upload store holds the real id, exactly as it does during the
// upload-then-annotate window.

vi.mock('../utils/apiFetch', () => ({ default: vi.fn() }));

vi.mock('../modes/annotate', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useAnnotateState: (...args) => ({
      ...actual.useAnnotateState(...args),
      annotateGameId: null,
      annotateVideoMetadata: { duration: 120 },
    }),
  };
});

import apiFetch from '../utils/apiFetch';
import { AnnotateContainer } from './AnnotateContainer';
import { useAuthStore } from '../stores/authStore';
import { useQuestStore } from '../stores/questStore';
import { useUploadStore } from '../stores/uploadStore';
import { useToastStore } from '../components/shared/Toast';

const flushMicrotasks = () => new Promise((r) => setTimeout(r, 0));

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
    // T1540's restore effect calls this as soon as an upload is in flight.
    getGame: vi.fn().mockResolvedValue({ annotations: [] }),
    loadGame: vi.fn(),
    fetchProjects: vi.fn(),
    setEditorMode: vi.fn(),
    onOpenReelInFocus: vi.fn(),
    ...overrides,
  };
}

const authOriginal = useAuthStore.getState();
const questOriginal = useQuestStore.getState();
const uploadOriginal = useUploadStore.getState();

const saveCalls = () => apiFetch.mock.calls.filter(([url]) => String(url).includes('/clips/raw/save'));

describe('AnnotateContainer game-id resolution (T11040)', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    apiFetch.mockImplementation((url) => {
      if (String(url).includes('/clips/raw/save')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ raw_clip_id: 555 }) });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    });
    useAuthStore.setState({ isAuthenticated: true });
    useQuestStore.setState({
      recordAchievement: vi.fn(),
      fetchProgress: vi.fn().mockResolvedValue(undefined),
    });
    useUploadStore.setState({ uploads: [] });
    window.matchMedia = (query) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    });
    useToastStore.setState({ toasts: [] });
  });

  afterEach(() => {
    useAuthStore.setState(authOriginal, true);
    useQuestStore.setState(questOriginal, true);
    useUploadStore.setState(uploadOriginal, true);
    useToastStore.setState({ toasts: [] });
  });

  it('Mark Play still saves when the id is only on the in-flight upload entry', async () => {
    useUploadStore.setState({
      uploads: [{ id: 'u1', status: 'uploading', gameId: 4, uploads: [] }],
    });

    const { result } = renderHook(() => AnnotateContainer(baseProps()));

    await act(async () => {
      result.current.handleAddClipFromButton();
      await flushMicrotasks();
    });

    // The region exists locally AND the write actually went out, against game 4.
    expect(result.current.clipRegions.length).toBe(1);
    expect(saveCalls().length).toBe(1);
    expect(JSON.parse(saveCalls()[0][1].body).game_id).toBe(4);
  });

  it('Mark Play with no id anywhere fails LOUDLY instead of reporting success', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderHook(() => AnnotateContainer(baseProps()));

    let outcome;
    await act(async () => {
      outcome = await result.current.handleFullscreenCreateClip({
        startTime: 5,
        duration: 4,
        tags: [],
        name: 'Play 1',
        notes: '',
        tagged_teammates: [],
        my_athlete: true,
        createProject: false,
      });
      await flushMicrotasks();
    });

    // The pre-T11040 bug was this returning saveOk:true with no request.
    expect(outcome.saveOk).toBe(false);
    expect(saveCalls().length).toBe(0);
    expect(errSpy).toHaveBeenCalled();
    expect(useToastStore.getState().toasts.some(t => /Could not save this play/.test(t.title))).toBe(true);
    errSpy.mockRestore();
  });

  it('Frame Later (createProject update) reaches the network via the resolved id', async () => {
    useUploadStore.setState({
      uploads: [{ id: 'u1', status: 'uploading', gameId: 4, uploads: [] }],
    });

    const { result } = renderHook(() => AnnotateContainer(baseProps()));

    await act(async () => {
      result.current.handleAddClipFromButton();
      await flushMicrotasks();
    });
    const regionId = result.current.clipRegions[0].id;

    apiFetch.mockClear();
    apiFetch.mockImplementation((url, opts) => {
      if (opts?.method === 'PUT') {
        return Promise.resolve({
          ok: true, status: 200,
          json: async () => ({ success: true, project_created: true, project_id: 77 }),
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    });

    let outcome;
    await act(async () => {
      outcome = await result.current.updateClipRegion(regionId, { createProject: true });
      await flushMicrotasks();
    });

    // Pre-T11040 this returned {saveOk:true, projectId:null} with no request —
    // the button "did nothing" and no clip appeared in Clips.
    expect(outcome.projectId).toBe(77);
    expect(apiFetch.mock.calls.some(([, o]) => o?.method === 'PUT')).toBe(true);
  });

  it('a no-id update fails LOUDLY rather than silently dropping the change', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    useUploadStore.setState({
      uploads: [{ id: 'u1', status: 'uploading', gameId: 4, uploads: [] }],
    });
    const { result } = renderHook(() => AnnotateContainer(baseProps()));

    await act(async () => {
      result.current.handleAddClipFromButton();
      await flushMicrotasks();
    });
    const regionId = result.current.clipRegions[0].id;

    // The upload finishes and retires, so no id is resolvable any more.
    useUploadStore.setState({ uploads: [] });
    apiFetch.mockClear();

    let outcome;
    await act(async () => {
      outcome = await result.current.updateClipRegion(regionId, { rating: 5 });
      await flushMicrotasks();
    });

    expect(outcome.saveOk).toBe(false);
    expect(apiFetch).not.toHaveBeenCalled();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
