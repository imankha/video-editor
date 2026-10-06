import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

/**
 * T11430 fixround2 MAJOR: pins the exact backend field NAMES the container sends
 * for "Make Another Highlight". A casing typo (forceNew / aspectRatio instead of
 * force_new / aspect_ratio) would silently never reach update_raw_clip's
 * force_new branch — exactly the class of gap that let round-1's wrong-orientation
 * bug through. Drives the REAL AnnotateContainer hook with apiFetch mocked and
 * asserts the literal PUT body keys.
 *
 * Harness mirrors AnnotateContainer.createAtTap.test.jsx.
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

async function markPlay(result) {
  await act(async () => { result.current.handleAddClipFromButton(); });
  await act(async () => { await flush(); });
  return result.current.clipRegions[0].id;
}

function putBodies() {
  return apiFetch.mock.calls
    .filter(([, opts]) => opts?.method === 'PUT')
    .map(([, opts]) => JSON.parse(opts.body));
}

describe('AnnotateContainer — Make Another Highlight sends snake_case backend fields (T11430 fixround2)', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    apiFetch.mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ raw_clip_id: 1, project_created: true, project_id: 99, success: true }),
    });
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
    useToastStore.setState({ toasts: [] });
  });

  it('forceNew + aspectRatio map to literal force_new + aspect_ratio keys in the PUT body', async () => {
    const { result } = renderHook(() => AnnotateContainer(baseProps()));
    const id = await markPlay(result);

    await act(async () => {
      await result.current.updateClipRegion(id, {
        createProject: true, forceNew: true, aspectRatio: '16:9',
      });
    });
    await act(async () => { await flush(); });

    const body = putBodies().find((b) => b.force_new === true);
    expect(body, 'a PUT body carrying force_new must have been sent').toBeTruthy();
    // Exact snake_case keys — a casing typo must fail here.
    expect(body).toHaveProperty('force_new', true);
    expect(body).toHaveProperty('aspect_ratio', '16:9');
    expect(body).toHaveProperty('create_project', true);
    // And NOT the camelCase forms.
    expect(body).not.toHaveProperty('forceNew');
    expect(body).not.toHaveProperty('aspectRatio');
  });
});
