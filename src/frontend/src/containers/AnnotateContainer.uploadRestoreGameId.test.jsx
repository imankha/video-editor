import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// T12790 regression: reopening a game whose upload is still in flight (the
// uploading game tile on Home) left `annotateGameId` null for the rest of the
// upload. The blob-restore effect reset the id the T1540 mount effect had just
// restored, and nothing picked up an id created after the remount. AnnotateScreen
// holds the guide (and the first-run chrome) until a game id exists, so the
// screen showed no guidance at all while the game uploaded.

vi.mock('../utils/apiFetch', () => ({ default: vi.fn() }));
vi.mock('../utils/videoMetadata', async (importOriginal) => ({
  ...(await importOriginal()),
  extractVideoMetadata: vi.fn(async (f) => ({ duration: f.name === 'a.mp4' ? 20 : 15, width: 1920, height: 1080 })),
}));

import apiFetch from '../utils/apiFetch';
import { AnnotateContainer } from './AnnotateContainer';
import { useAuthStore } from '../stores/authStore';
import { useQuestStore } from '../stores/questStore';
import { useUploadStore } from '../stores/uploadStore';
import { toast } from '../components/shared';

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

  it('restores ALL local videos of a multi-file upload, not just the first (T13245)', async () => {
    const gameVideos = [
      { sequence: 1, url: 'blob:v1', duration: 20, offset_seconds: 75 },
      { sequence: 2, url: 'blob:v2', duration: 15, offset_seconds: 905 },
      { sequence: 3, url: 'blob:v3', duration: 30, offset_seconds: 1200 },
    ];
    useUploadStore.setState({ uploads: [{ ...uploading(42), blobUrl: 'blob:v1', gameVideos }] });
    const { result } = renderHook(() => AnnotateContainer(baseProps()));
    await act(flushMicrotasks);

    expect(result.current.annotateVideoUrl).toBe('blob:v1');
    expect(result.current.gameVideos).toEqual(gameVideos);
  });
});

describe('AnnotateContainer creating a Veo-zip game (T13245)', () => {
  const details = () => ({
    name: 'WCFC vs. Legends (1st Half)',
    opponentName: 'Legends',
    files: [
      { file: new File(['x'], 'a.mp4'), sequence: 1, offset_seconds: 75, durationS: 20 },
      { file: new File(['y'], 'b.mp4'), sequence: 2, offset_seconds: 905, durationS: 15 },
    ],
    // The pick list's mvhd read can differ in the last digits from the browser's metadata
    // read that the create sends as each video's duration (25.012 vs 25.011333 in the wild).
    veoSuggestions: [
      { video_sequence: 1, start: 0, end: 20.0007, labels: ['Goal'] },
      { video_sequence: 2, start: 0, end: 15.0004, labels: ['Attack'] },
    ],
  });
  // What must be POSTed: each moment ends at the SAME duration its video is created with.
  const postedMoments = [
    { video_sequence: 1, start: 0, end: 20, labels: ['Goal'] },
    { video_sequence: 2, start: 0, end: 15, labels: ['Attack'] },
  ];
  const suggestionPosts = () => apiFetch.mock.calls.filter(([u, o]) => /\/api\/games\/77\/suggestions$/.test(u) && o?.method === 'POST');
  let startUpload;
  let originalCreate;

  beforeEach(() => {
    apiFetch.mockReset();
    useAuthStore.setState({ isAuthenticated: true });
    useQuestStore.setState({ recordAchievement: vi.fn(), fetchProgress: vi.fn().mockResolvedValue(undefined) });
    window.matchMedia = (query) => ({
      matches: false, media: query, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    });
    originalCreate = URL.createObjectURL;
    URL.createObjectURL = (f) => `blob:${f.name}`;
    startUpload = vi.fn();
    useUploadStore.setState({ uploads: [], startUpload });
  });

  afterEach(() => {
    URL.createObjectURL = originalCreate;
    useAuthStore.setState(authOriginal, true);
    useQuestStore.setState(questOriginal, true);
    useUploadStore.setState(uploadOriginal, true);
    vi.restoreAllMocks();
  });

  it('carries offsets into the blob videos and the upload metadata, and POSTs the suggestions BEFORE the game id is set', async () => {
    let finishPost;
    apiFetch.mockImplementation((url) => {
      if (/\/suggestions$/.test(url)) return new Promise((r) => { finishPost = () => r({ ok: true, status: 200, json: async () => ({}) }); });
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    });
    const { result } = renderHook(() => AnnotateContainer(baseProps()));
    await act(flushMicrotasks);

    await act(async () => { await result.current.handleGameVideoSelect(null, details()); });

    expect(result.current.gameVideos.map((v) => [v.sequence, v.url, v.offset_seconds, v.original_filename]))
      .toEqual([[1, 'blob:a.mp4', 75, 'a.mp4'], [2, 'blob:b.mp4', 905, 'b.mp4']]);
    const [files, passedDetails, metadataList, , displayInfo, onGameCreated] = startUpload.mock.calls[0];
    expect(files.map((f) => f.name)).toEqual(['a.mp4', 'b.mp4']);
    expect(passedDetails.name).toBe('WCFC vs. Legends (1st Half)');
    expect(metadataList.map((m) => [m.duration, m.offset_seconds])).toEqual([[20, 75], [15, 905]]);
    expect(displayInfo.gameVideos).toBe(result.current.gameVideos);

    // The store sets the entry's gameId the moment the game exists; that must not expose the id early.
    useUploadStore.setState({ uploads: [{ id: 'u', status: 'uploading', gameId: 77, blobUrl: 'blob:a.mp4' }] });
    let created;
    act(() => { created = onGameCreated({ game_id: 77, name: 'WCFC vs. Legends (1st Half)' }); });
    await act(flushMicrotasks);
    expect(suggestionPosts()).toHaveLength(1);
    expect(JSON.parse(suggestionPosts()[0][1].body)).toEqual({ source: 'veo_zip', moments: postedMoments });
    expect(result.current.annotateGameId).toBe(null);

    await act(async () => { finishPost(); await created; });
    expect(result.current.annotateGameId).toBe(77);
  });

  it('T13246: with an opponent the local name is the title the server will list; without one it is the zip title', async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    const { result } = renderHook(() => AnnotateContainer(baseProps()));
    await act(flushMicrotasks);

    await act(async () => {
      await result.current.handleGameVideoSelect(null, { ...details(), gameType: 'away', gameDate: '2026-03-28' });
    });
    expect(startUpload.mock.calls[0][4].gameName).toBe('at Legends Mar 28');

    await act(async () => { await result.current.handleGameVideoSelect(null, { ...details(), opponentName: '' }); });
    expect(startUpload.mock.calls[1][4].gameName).toBe('WCFC vs. Legends (1st Half)');
  });

  it('a failed suggestions POST is logged and toasted, and the game still opens', async () => {
    apiFetch.mockImplementation((url) => Promise.resolve(
      /\/suggestions$/.test(url) ? { ok: false, status: 500, json: async () => ({}) } : { ok: true, status: 200, json: async () => ({}) },
    ));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const toastSpy = vi.spyOn(toast, 'error').mockImplementation(() => {});
    const { result } = renderHook(() => AnnotateContainer(baseProps()));
    await act(flushMicrotasks);
    await act(async () => { await result.current.handleGameVideoSelect(null, details()); });
    const onGameCreated = startUpload.mock.calls[0][5];

    await act(async () => { await onGameCreated({ game_id: 77, name: 'G' }); });

    expect(errSpy).toHaveBeenCalled();
    expect(toastSpy).toHaveBeenCalledWith('Could not import these highlights. Try again.');
    expect(result.current.annotateGameId).toBe(77);
  });

  it('a one-pick game still sends the offset and its suggestion, through the placed upload path', async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    const one = details();
    one.files = one.files.slice(0, 1);
    one.veoSuggestions = one.veoSuggestions.slice(0, 1);
    const { result } = renderHook(() => AnnotateContainer(baseProps()));
    await act(flushMicrotasks);
    await act(async () => { await result.current.handleGameVideoSelect(null, one); });

    const [files, , metadataList, , , onGameCreated] = startUpload.mock.calls[0];
    expect(Array.isArray(files)).toBe(true);
    expect(files).toHaveLength(1);
    expect(metadataList[0].offset_seconds).toBe(75);
    await act(async () => { await onGameCreated({ game_id: 77, name: 'G' }); });
    expect(JSON.parse(suggestionPosts()[0][1].body).moments).toEqual(postedMoments.slice(0, 1));
  });
});

describe('AnnotateContainer re-uploading a video already in a game (T13540)', () => {
  let startUpload;
  let originalCreate;
  beforeEach(() => {
    apiFetch.mockReset();
    apiFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    useAuthStore.setState({ isAuthenticated: true });
    useQuestStore.setState({ recordAchievement: vi.fn(), fetchProgress: vi.fn().mockResolvedValue(undefined) });
    window.matchMedia = (query) => ({
      matches: false, media: query, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    });
    originalCreate = URL.createObjectURL;
    URL.createObjectURL = (f) => `blob:${f.name}`;
    startUpload = vi.fn();
    useUploadStore.setState({ uploads: [], startUpload });
  });
  afterEach(() => {
    URL.createObjectURL = originalCreate;
    useAuthStore.setState(authOriginal, true);
    useQuestStore.setState(questOriginal, true);
    useUploadStore.setState(uploadOriginal, true);
  });

  it('opens the EXISTING game through the normal load, and does not import its plays against the local 5s copy', async () => {
    const props = baseProps();
    // The existing game's plays (0:26 / 0:43) are far past the 5 s file that was re-uploaded.
    props.getGame = vi.fn().mockResolvedValue({
      annotations: [{ id: 1, start_time: 26, end_time: 36, name: 'p', rating: 4 }],
    });
    props.loadGame = vi.fn().mockResolvedValue({ id: 42, name: 'Vs Carlsbad QA', videos: [], annotations: [] });
    const { result } = renderHook(() => AnnotateContainer(props));
    await act(flushMicrotasks);
    await act(async () => { await result.current.handleGameVideoSelect(new File(['x'], 'game2-test.mp4'), { opponentName: 'x' }); });
    const onGameCreated = startUpload.mock.calls[0][5];

    await act(async () => { await onGameCreated({ game_id: 42, name: 'Vs Carlsbad QA', alreadyOwned: true }); });
    await act(flushMicrotasks);

    expect(props.loadGame).toHaveBeenCalledWith(42);
    expect(props.getGame).not.toHaveBeenCalled();
  });

  it('does not open the game when the screen that started the upload has unmounted', async () => {
    const props = baseProps();
    props.loadGame = vi.fn().mockResolvedValue({ id: 42, name: 'Vs Carlsbad QA', videos: [], annotations: [] });
    const { result, unmount } = renderHook(() => AnnotateContainer(props));
    await act(flushMicrotasks);
    await act(async () => { await result.current.handleGameVideoSelect(new File(['x'], 'game2-test.mp4'), { opponentName: 'x' }); });
    const onGameCreated = startUpload.mock.calls[0][5];
    unmount();

    await act(async () => { await onGameCreated({ game_id: 42, name: 'Vs Carlsbad QA', alreadyOwned: true }); });

    expect(props.loadGame).not.toHaveBeenCalled();
  });
});
