/**
 * T17660: the Add video preview prices the whole selection once
 * (calculateUploadCost(totalBytes), AddFootageButton), and POST /api/games/{id}/videos
 * charges calculateUploadCost(sum of the request's file sizes) PER REQUEST
 * (games.py add_videos_to_game). So the credits taken equal the preview only when
 * every selected video travels in ONE request. This pins that, with a fake server
 * that charges exactly the way the real endpoint does.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { calculateUploadCost } from '../utils/storageCost';

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
vi.mock('../stores/editorStore', () => ({
  useEditorStore: {
    getState: () => ({ isAnnotateMode: () => false, activeAnnotateGameId: null }),
  },
}));

// A 1-byte File reports a fake (up to multi-GB) size; skip the MP4 structure read.
vi.mock('../utils/mp4Faststart', () => ({
  analyzeMp4Faststart: vi.fn(async () => ({ needsRelocation: false, moovSize: 0, analysisTimeMs: 0 })),
  getReorderedSlice: vi.fn(),
}));
vi.mock('../utils/shrinkCapability', () => ({ probeAndReport: vi.fn() }));

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

class MockWorker {
  constructor() { this.onmessage = null; this.onerror = null; }
  postMessage(data) {
    setTimeout(() => {
      this.onmessage?.({
        data: {
          type: 'complete',
          hash: data.file.name.padEnd(64, '0').slice(0, 64),
          fileName: data.file.name,
          fileSize: data.file.size,
        },
      });
    }, 0);
  }
  terminate() {}
}

const originalURL = globalThis.URL;
const MB = 1024 ** 2;

function sizedFile(name, bytes) {
  const file = new File(['x'], name, { type: 'video/mp4' });
  Object.defineProperty(file, 'size', { value: bytes });
  return file;
}

// prepare-upload dedups (no byte transfer) and echoes the file's size; /videos charges
// calculateUploadCost(sum of the posted sizes), as the real endpoint does.
function installChargingServer(ledger) {
  mockFetch.mockImplementation((url, init) => {
    const u = String(url);
    if (u.includes('/prepare-upload')) {
      const body = JSON.parse(init.body);
      return Promise.resolve({
        ok: true,
        json: async () => ({ status: 'exists', blake3_hash: body.blake3_hash, file_size: body.file_size }),
      });
    }
    if (u.includes('/api/games/42/videos')) {
      const { videos } = JSON.parse(init.body);
      const size = videos.reduce((sum, v) => sum + (v.file_size || 0), 0);
      const charged = size > 0 ? calculateUploadCost(size) : 1;
      ledger.push(charged);
      return Promise.resolve({
        ok: true,
        json: async () => ({ game_id: 42, videos_added: videos.length, videos: [], upload_cost_charged: charged }),
      });
    }
    return Promise.resolve({ ok: true, json: async () => ({}) });
  });
}

describe('attachVideoToExistingGame — T17660 credits taken equal the preview', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    gamesDataStoreMock.loadGame.mockResolvedValue({ game: { id: 1 } });
    globalThis.Worker = MockWorker;
    globalThis.URL = class extends originalURL {
      static createObjectURL = vi.fn(() => 'blob:mock');
    };
  });
  afterEach(() => { globalThis.URL = originalURL; });

  const selections = {
    'one small video': [5 * MB],
    'two small videos (the QA repro)': [5 * MB, 5 * MB],
    'an 89 s video plus a 5 s fixture': [180 * MB, 5 * MB],
    'several videos under one GB each': [300 * MB, 300 * MB, 300 * MB, 5 * MB],
    'several videos over one GB in total': [700 * MB, 700 * MB, 900 * MB],
  };

  for (const [label, sizes] of Object.entries(selections)) {
    it(`${label}: total charged equals calculateUploadCost(total bytes)`, async () => {
      const ledger = [];
      installChargingServer(ledger);
      const { attachVideoToExistingGame } = await import('./uploadManager');
      const files = sizes.map((bytes, i) => ({ file: sizedFile(`v${i}.mp4`, bytes), recorded_at: null }));
      const totalBytes = sizes.reduce((a, b) => a + b, 0);

      await attachVideoToExistingGame(42, files, () => {});

      const charged = ledger.reduce((a, b) => a + b, 0);
      expect(charged).toBe(calculateUploadCost(totalBytes));
    }, 30000); // the first hash-wasm init in a file can take several seconds
  }
});
