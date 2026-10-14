import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// T12790 regression: reopening a game whose upload is still in flight (the
// uploading game tile on Home) left `annotateGameId` null for the rest of the
// upload. The blob-restore effect reset the id the T1540 mount effect had just
// restored, and nothing picked up an id created after the remount. AnnotateScreen
// holds the guide (and the first-run chrome) until a game id exists, so the
// screen showed no guidance at all while the game uploaded.

vi.mock('../utils/apiFetch', () => ({ default: vi.fn() }));

import apiFetch from '../utils/apiFetch';
import { AnnotateContainer } from './AnnotateContainer';
import { useAuthStore } from '../stores/authStore';
import { useQuestStore } from '../stores/questStore';
import { useUploadStore } from '../stores/uploadStore';

const flushMicrotasks = () => new Promise((r) => setTimeout(r, 0));

function baseProps() {
  return {
    videoRef: { current: null },
    currentTime: 0,
    duration: 120,
    isPlaying: false,
    togglePlay: vi.fn(),
    pause: vi.fn(),
    stepForward: vi.fn(),
    stepBackward: vi.fn(),
    seekBackward: vi.fn(),
    restart: vi.fn(),
    seek: vi.fn(),
    getGame: vi.fn().mockResolvedValue({ annotations: [] }),
    loadGame: vi.fn(),
    fetchProjects: vi.fn(),
    setEditorMode: vi.fn(),
    onOpenReelInFocus: vi.fn(),
  };
}

const uploading = (gameId) => ({
  id: 'u1', status: 'uploading', gameId, createdGameName: gameId ? 'Nov 16 game' : null,
  gameName: 'nov-16.mp4', blobUrl: 'blob:local-game', videoMetadata: { duration: 6158 }, uploads: [],
});

const authOriginal = useAuthStore.getState();
const questOriginal = useQuestStore.getState();
const uploadOriginal = useUploadStore.getState();

describe('AnnotateContainer reopening an uploading game (T12790)', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    apiFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    useAuthStore.setState({ isAuthenticated: true });
    useQuestStore.setState({ recordAchievement: vi.fn(), fetchProgress: vi.fn().mockResolvedValue(undefined) });
    window.matchMedia = (query) => ({
      matches: false, media: query, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    });
  });

  afterEach(() => {
    useAuthStore.setState(authOriginal, true);
    useQuestStore.setState(questOriginal, true);
    useUploadStore.setState(uploadOriginal, true);
  });

  it('keeps the created game id when the upload\'s local video is restored', async () => {
    useUploadStore.setState({ uploads: [uploading(42)] });
    const { result } = renderHook(() => AnnotateContainer(baseProps()));
    await act(flushMicrotasks);

    expect(result.current.annotateVideoUrl).toBe('blob:local-game');
    expect(result.current.annotateGameId).toBe(42);
  });

  it('picks up a game id created after the screen was reopened', async () => {
    useUploadStore.setState({ uploads: [uploading(null)] });
    const { result } = renderHook(() => AnnotateContainer(baseProps()));
    await act(flushMicrotasks);
    expect(result.current.annotateGameId).toBe(null);

    await act(async () => {
      useUploadStore.setState({ uploads: [uploading(43)] });
      await flushMicrotasks();
    });
    expect(result.current.annotateGameId).toBe(43);
  });
});
