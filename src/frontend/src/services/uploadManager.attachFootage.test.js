/**
 * T8910: attachVideoToExistingGame generalized from a single File to a list of
 * {file, recorded_at} entries (add footage from inside Annotate). This pins the
 * ATTACH PAYLOAD SHAPE: N sequential POSTs to /api/games/{id}/videos, each
 * carrying its own recorded_at + original_filename, server-assigned sequence
 * (omitted client-side), plus "Video {i} of {n}" progress labels. Backward
 * compatibility with the bare-File call (T8700's AttachVideoModal) is also pinned.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { gamesDataStoreMock } = vi.hoisted(() => ({
  gamesDataStoreMock: {
    invalidateGames: vi.fn(),
    loadGame: vi.fn().mockResolvedValue({ game: { id: 1 } }),
    getGame: vi.fn().mockResolvedValue({ id: 1 }),
  },
}));
vi.mock('../stores/gamesDataStore', () => ({
  useGamesDataStore: { getState: () => gamesDataStoreMock },
}));
vi.mock('../stores/questStore', () => ({
  useQuestStore: { getState: () => ({ fetchProgress: vi.fn() }) },
}));
vi.mock('../stores/editorStore', () => ({
  useEditorStore: {
    getState: () => ({ isAnnotateMode: () => false, activeAnnotateGameId: null }),
  },
}));

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

class MockWorker {
  constructor() { this.onmessage = null; this.onerror = null; }
  postMessage(data) {
    setTimeout(() => {
      this.onmessage?.({
        data: {
          type: 'complete',
          hash: 'b'.repeat(64),
          fileName: data.file?.name || 'clip.mp4',
          fileSize: data.file?.size || 2048,
        },
      });
    }, 0);
  }
  terminate() {}
}

const originalURL = globalThis.URL;

// URL-routed mock: prepare-upload always dedups (status 'exists', no byte
// transfer); the /videos endpoint records each posted body and returns the
// append-only result. Routing by URL avoids sequential-mock ordering fragility.
function installFetch(videoPosts) {
  mockFetch.mockImplementation((url) => {
    const u = String(url);
    if (u.includes('/prepare-upload')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ status: 'exists', blake3_hash: 'b'.repeat(64), file_size: 2048 }),
      });
    }
    if (u.includes('/videos')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          game_id: 42,
          videos_added: 1,
          videos: [{ sequence: videoPosts.length + 2, blake3_hash: 'b'.repeat(64), video_url: 'u' }],
          upload_cost_charged: 3,
        }),
      });
    }
    return Promise.resolve({ ok: true, json: async () => ({}) });
  });
}

function postedVideoBodies() {
  return mockFetch.mock.calls
    .filter(([url]) => String(url).includes('/api/games/42/videos'))
    .map(([, init]) => JSON.parse(init.body));
}

describe('attachVideoToExistingGame — T8910 multi-file payload', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    gamesDataStoreMock.invalidateGames.mockClear();
    gamesDataStoreMock.loadGame.mockClear();
    globalThis.Worker = MockWorker;
    globalThis.URL = class extends originalURL {
      static createObjectURL = vi.fn(() => 'blob:mock');
    };
    installFetch([]);
  });
  afterEach(() => { globalThis.URL = originalURL; });

  it('POSTs one videoRef per file, each with its recorded_at + original_filename, no client sequence', async () => {
    const { attachVideoToExistingGame } = await import('./uploadManager');
    const files = [
      { file: new File(['a'], 'first.mp4', { type: 'video/mp4' }), recorded_at: '2026-07-18T18:00:00Z' },
      { file: new File(['b'], 'second.mp4', { type: 'video/mp4' }), recorded_at: null },
    ];
    await attachVideoToExistingGame(42, files, () => {});

    const bodies = postedVideoBodies();
    expect(bodies).toHaveLength(2);
    // Each POST carries exactly one videoRef (append-only, one at a time).
    expect(bodies[0].videos).toHaveLength(1);
    expect(bodies[0].videos[0].recorded_at).toBe('2026-07-18T18:00:00Z');
    expect(bodies[0].videos[0].original_filename).toBe('first.mp4');
    expect(bodies[0].videos[0].sequence).toBeUndefined(); // server assigns it
    expect(bodies[1].videos[0].recorded_at).toBeNull();
    expect(bodies[1].videos[0].original_filename).toBe('second.mp4');
  });

  it('emits "Video {i} of {n}" progress labels for a multi-file attach', async () => {
    const { attachVideoToExistingGame } = await import('./uploadManager');
    const files = [
      { file: new File(['a'], 'first.mp4', { type: 'video/mp4' }), recorded_at: null },
      { file: new File(['b'], 'second.mp4', { type: 'video/mp4' }), recorded_at: null },
    ];
    const messages = [];
    await attachVideoToExistingGame(42, files, (p) => messages.push(p.message));
    expect(messages.some((m) => m?.startsWith('Video 1 of 2:'))).toBe(true);
    expect(messages.some((m) => m?.startsWith('Video 2 of 2:'))).toBe(true);
  });

  it('accepts a bare File (T8700 AttachVideoModal call) unchanged — 1 POST, null recorded_at', async () => {
    const { attachVideoToExistingGame } = await import('./uploadManager');
    const file = new File(['x'], 'half2.mp4', { type: 'video/mp4' });
    const messages = [];
    await attachVideoToExistingGame(42, file, (p) => messages.push(p.message));

    const bodies = postedVideoBodies();
    expect(bodies).toHaveLength(1);
    expect(bodies[0].videos[0].recorded_at).toBeNull();
    expect(bodies[0].videos[0].original_filename).toBe('half2.mp4');
    // Single-file attach keeps its bare (un-prefixed) progress messages.
    expect(messages.some((m) => m?.startsWith('Video 1 of'))).toBe(false);
  });

  it('reloads the game once after all files land', async () => {
    const { attachVideoToExistingGame } = await import('./uploadManager');
    const files = [
      { file: new File(['a'], 'first.mp4', { type: 'video/mp4' }), recorded_at: null },
      { file: new File(['b'], 'second.mp4', { type: 'video/mp4' }), recorded_at: null },
    ];
    await attachVideoToExistingGame(42, files, () => {});
    expect(gamesDataStoreMock.loadGame).toHaveBeenCalledTimes(1);
    expect(gamesDataStoreMock.loadGame).toHaveBeenCalledWith(42);
  });
});
