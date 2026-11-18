import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// T17210: "Keep marking plays" (the Highlight choice card's "later" button)
// keeps the play and returns to marking. It must NOT create a highlight (an
// in-progress portrait project the parent never asked for); only "Make
// highlight" does that.
//
// Drives the REAL AnnotateContainer through renderHook (same harness as
// AnnotateContainer.createAtTap.test.jsx).

// T11175: the Add Clip beacon is a funnel event; keep it off the mocked apiFetch.
vi.mock('../utils/funnelEvents', async (orig) => ({ ...(await orig()), recordFunnelEvent: vi.fn() }));
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
    getGame: vi.fn(),
    loadGame: vi.fn(),
    fetchProjects: vi.fn(),
    setEditorMode: vi.fn(),
    onOpenReelInFocus: vi.fn(),
    ...overrides,
  };
}

const authOriginal = useAuthStore.getState();

describe('AnnotateContainer "Keep marking plays" creates no highlight (T17210)', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    useAuthStore.setState({ isAuthenticated: true });
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
    useToastStore.setState({ toasts: [] });
  });


  it('T17210:C1 "Keep marking plays" sends no create_project and shows no highlight toast', async () => {
    const createCalls = [];
    apiFetch.mockImplementation((url, opts) => {
      if (url.includes('/clips/raw/save')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ raw_clip_id: 1 }) });
      }
      if (opts?.method === 'PUT') {
        const body = JSON.parse(opts.body);
        if (body.create_project) {
          createCalls.push(body);
          return Promise.resolve({
            ok: true, status: 200,
            json: async () => ({ success: true, project_created: true, project_id: 999 }),
          });
        }
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true }) });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    });

    const { result } = renderHook(() => AnnotateContainer(baseProps()));
    act(() => {
      result.current.handleAddClipFromButton();
    });
    await act(async () => { await flushMicrotasks(); });
    const regionId = result.current.clipRegions[0].id;
    act(() => {
      result.current.updateClipRegion(regionId, { rating: 5 });
    });
    await act(async () => { await flushMicrotasks(); });
    act(() => {
      result.current.handleOverlayClose();
    });
    expect(result.current.highlightChoice).toEqual({ regionId });

    await act(async () => {
      await result.current.handleHighlightChoiceLater();
      await flushMicrotasks();
    });

    expect(result.current.highlightChoice).toBeNull();
    expect(createCalls).toEqual([]);
    expect(result.current.clipRegions[0].autoProjectId ?? null).toBeNull();
    expect(useToastStore.getState().toasts).toEqual([]);
  });
});
