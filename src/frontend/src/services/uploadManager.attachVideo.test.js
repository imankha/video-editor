/**
 * T8700 (Tester Phase 1, RED): attachVideoToExistingGame is a NEW export
 * uploadManager.js does not have yet. It should reuse the existing
 * hashAndAnalyze -> R2 multipart upload -> addVideosToGame transport
 * (the same 3 steps uploadMultiVideoGame already runs for halves >= 2),
 * per docs/plans/tasks/T8700-design.md section 3 Phase 2 / section 6 test 10.
 *
 * This whole file is expected to fail to even import until the implementor
 * adds `attachVideoToExistingGame` to uploadManager.js's exports -- that is
 * the intended RED signal (missing behavior, not a harness bug).
 *
 * TEST-CONTRACT AMBIGUITY FLAGGED FOR IMPLEMENTOR: the design's pseudocode
 * (section 3) calls `await reloadGame(gameId)` after a successful attach, but
 * does not pin down which gamesDataStore action that is. This test asserts
 * the STABLE part of the contract (a reload of the game's data is triggered
 * on success, via gamesDataStore) without hard-coding loadGame vs getGame --
 * see the `reloadTriggered` helper below. If the implementor picks loadGame
 * (the richer /load endpoint Annotate itself uses, per the design's own
 * "re-loads the game so Annotate's timeline picks up the new half"), tighten
 * this assertion to loadGame specifically.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock stores exactly like uploadManager.test.js does, since
// attachVideoToExistingGame is expected to share uploadMultiVideoGame's
// dynamic-import reload/invalidate pattern.
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
  constructor() {
    this.onmessage = null;
    this.onerror = null;
  }
  postMessage(data) {
    setTimeout(() => {
      if (this.onmessage) {
        this.onmessage({
          data: {
            type: 'complete',
            hash: 'b'.repeat(64),
            fileName: data.file?.name || 'second-half.mp4',
            fileSize: data.file?.size || 2048,
          },
        });
      }
    }, 0);
  }
  terminate() {}
}

const originalURL = globalThis.URL;

describe('attachVideoToExistingGame (T8700, new helper)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    gamesDataStoreMock.invalidateGames.mockClear();
    gamesDataStoreMock.loadGame.mockClear();
    gamesDataStoreMock.getGame.mockClear();
    globalThis.Worker = MockWorker;
    globalThis.URL = class extends originalURL {
      static createObjectURL = vi.fn(() => 'blob:mock-url');
    };
  });

  afterEach(() => {
    globalThis.URL = originalURL;
  });

  it('is exported from uploadManager', async () => {
    const mod = await import('./uploadManager');
    expect(typeof mod.attachVideoToExistingGame).toBe('function');
  });

  it('runs hash -> upload -> addVideosToGame in order, then reloads the game', async () => {
    const { attachVideoToExistingGame } = await import('./uploadManager');
    expect(typeof attachVideoToExistingGame).toBe('function');

    // Step 1 (implicit): hashing goes through the mocked Worker, no fetch.
    // Step 2: prepare-upload — video already in R2 (dedup path), skips actual
    // multipart upload calls so this test stays about ORDER, not byte transfer.
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 'exists', blake3_hash: 'b'.repeat(64), file_size: 2048 }),
    });
    // Step 3: POST /api/games/{id}/videos — the addVideosToGame transport.
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        game_id: 42,
        videos_added: 1,
        videos: [{ sequence: 2, blake3_hash: 'b'.repeat(64), video_url: 'https://example.com/2.mp4' }],
        upload_cost_charged: 3,
      }),
    });

    const mockFile = new File(['second half'], 'second-half.mp4', { type: 'video/mp4' });
    const progressUpdates = [];

    const result = await attachVideoToExistingGame(42, mockFile, (p) => progressUpdates.push(p));

    // Order: prepare-upload call must precede the attach (addVideosToGame) call.
    const prepareCallIndex = mockFetch.mock.calls.findIndex(([url]) =>
      String(url).includes('/prepare-upload')
    );
    const attachCallIndex = mockFetch.mock.calls.findIndex(([url]) =>
      String(url).includes('/api/games/42/videos')
    );
    expect(prepareCallIndex).toBeGreaterThanOrEqual(0);
    expect(attachCallIndex).toBeGreaterThan(prepareCallIndex);

    // The attach call posts to the addVideosToGame endpoint with a videos array.
    const [, attachInit] = mockFetch.mock.calls[attachCallIndex];
    const attachBody = JSON.parse(attachInit.body);
    expect(attachBody.videos).toHaveLength(1);
    expect(attachBody.videos[0].blake3_hash).toBe('b'.repeat(64));

    // Success triggers a game re-load (stable part of the contract — see file header).
    const reloadTriggered =
      gamesDataStoreMock.loadGame.mock.calls.length > 0 ||
      gamesDataStoreMock.getGame.mock.calls.length > 0 ||
      gamesDataStoreMock.invalidateGames.mock.calls.length > 0;
    expect(reloadTriggered).toBe(true);

    // Result surfaces the new video + cost so the caller can show a cost line.
    expect(result.videos_added).toBe(1);
    expect(result.upload_cost_charged).toBe(3);

    expect(progressUpdates.some((p) => p.phase === 'hashing')).toBe(true);
  });

  it('does NOT trigger a reload when the attach POST fails', async () => {
    const { attachVideoToExistingGame } = await import('./uploadManager');

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 'exists', blake3_hash: 'b'.repeat(64), file_size: 2048 }),
    });
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({ detail: 'Game is not ready' }),
    });

    const mockFile = new File(['second half'], 'second-half.mp4', { type: 'video/mp4' });

    await expect(attachVideoToExistingGame(42, mockFile, () => {})).rejects.toThrow();

    expect(gamesDataStoreMock.loadGame).not.toHaveBeenCalled();
    expect(gamesDataStoreMock.getGame).not.toHaveBeenCalled();
  });
});
