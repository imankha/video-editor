/**
 * T15050: one flow_id per file upload, on every request and beacon of that flow,
 * so `grep flow_id=<x>` in app.log shows the whole flow. On 2026-11-04 two flows
 * sharing a session could only be told apart by counting log lines by hand.
 *
 * Also pinned: /parts carries blake3_hash + kind (a 404 there used to be filed as
 * a game failure with no hash), and every beacon states its kind and the client
 * build, the build as a HEADER so it survives a beacon whose body never arrived.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ensureVideoInR2, sendUploadFailureBeacon, uploadGame } from './uploadManager';
import { __setClientBuildForTest } from '../utils/appVersion';

vi.mock('../stores/questStore', () => ({
  useQuestStore: { getState: () => ({ fetchProgress: vi.fn() }) },
}));
vi.mock('../stores/gamesDataStore', () => ({
  useGamesDataStore: { getState: () => ({ invalidateGames: vi.fn() }) },
}));
vi.mock('../stores/editorStore', () => ({
  useEditorStore: {
    getState: () => ({ isAnnotateMode: () => false, activeAnnotateGameId: null }),
  },
}));
vi.mock('../utils/shrinkCapability', () => ({ probeAndReport: vi.fn() }));
vi.mock('../utils/uiTelemetry', () => ({ recordUiImpression: vi.fn() }));

const HASH = 'c'.repeat(64);
const FLOW = 'flow-1234';
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

const jsonResp = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

function makeXHR(status) {
  return class MockXHR {
    constructor() { this.upload = {}; this.status = 200; }
    open() {}
    getResponseHeader(name) { return name === 'ETag' ? '"etag"' : null; }
    send() {
      setTimeout(() => {
        this.status = status;
        if (this.onload) this.onload();
      }, 0);
    }
    abort() {}
  };
}

const PRECOMPUTED = { blake3_hash: HASH, faststartInfo: { needsRelocation: false }, flow_id: FLOW };
const mockFile = () => new File(['test'], 'clip.mp4', { type: 'video/mp4' });
const uploadRequired = () => jsonResp(200, {
  status: 'upload_required',
  upload_session_id: 'sess_1',
  parts: [{ part_number: 1, presigned_url: 'https://r2/put', start_byte: 0, end_byte: 3 }],
});

const callTo = (fragment) => mockFetch.mock.calls.find(([u]) => String(u).includes(fragment));
const bodyOf = (fragment) => JSON.parse(callTo(fragment)[1].body);
const beacons = () => mockFetch.mock.calls
  .filter(([u]) => String(u).includes('upload-failure-beacon'))
  .map(([, o]) => JSON.parse(o.body));

describe('T15050 upload flow id', () => {
  let errorSpy;
  beforeEach(() => {
    vi.resetAllMocks();
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    globalThis.XMLHttpRequest = makeXHR(200);
    mockFetch.mockImplementation(async (url) => {
      if (url.includes('/prepare-upload')) return uploadRequired();
      if (url.includes('/finalize-upload')) return jsonResp(200, { blake3_hash: HASH, file_size: 4 });
      return jsonResp(200, {});
    });
  });
  afterEach(() => errorSpy.mockRestore());

  it('prepare, parts and finalize all carry the same flow_id', async () => {
    await ensureVideoInR2(mockFile(), () => {}, { kind: 'clip', precomputed: PRECOMPUTED });

    expect(bodyOf('/prepare-upload').flow_id).toBe(FLOW);
    expect(bodyOf('/finalize-upload').flow_id).toBe(FLOW);
    expect(bodyOf('/parts').flow_id).toBe(FLOW);
  });

  it('parts save carries the hash and kind so a 404 there is filed correctly', async () => {
    await ensureVideoInR2(mockFile(), () => {}, { kind: 'clip', precomputed: PRECOMPUTED });

    expect(bodyOf('/parts')).toMatchObject({ blake3_hash: HASH, kind: 'clip' });
  });

  it('a game upload states kind=game on /parts and on its failure beacon', async () => {
    mockFetch.mockImplementation(async (url) => {
      if (url.includes('/prepare-upload')) return uploadRequired();
      if (url.includes('/finalize-upload')) return jsonResp(500, { detail: 'nope' });
      return jsonResp(200, {});
    });

    await expect(ensureVideoInR2(mockFile(), () => {}, { precomputed: PRECOMPUTED })).rejects.toThrow();

    expect(bodyOf('/parts').kind).toBe('game');
    expect(beacons()).toHaveLength(1);
    expect(beacons()[0]).toMatchObject({ phase: 'finalizing', kind: 'game', flow_id: FLOW });
  });

  it('a transfer failure beacon carries the flow_id', async () => {
    globalThis.XMLHttpRequest = makeXHR(403);

    await expect(
      ensureVideoInR2(mockFile(), () => {}, { kind: 'clip', precomputed: PRECOMPUTED }),
    ).rejects.toThrow();

    expect(beacons()[0]).toMatchObject({ phase: 'uploading', kind: 'clip', flow_id: FLOW });
  });

  it('a rejected prepare beacons with the flow_id on every retry', async () => {
    mockFetch.mockImplementation(async (url) => {
      if (url.includes('/prepare-upload')) throw new TypeError('Failed to fetch');
      return jsonResp(200, {});
    });

    await expect(
      ensureVideoInR2(mockFile(), () => {}, { kind: 'clip', precomputed: PRECOMPUTED }),
    ).rejects.toThrow();

    expect(beacons().length).toBeGreaterThan(0);
    for (const payload of beacons()) {
      expect(payload).toMatchObject({ phase: 'preparing', reason: 'fetch_rejected', flow_id: FLOW });
    }
  });

  it('a hash death before prepare still beacons a flow_id and a kind', async () => {
    class ThrowingWorker {
      postMessage() { throw new Error('worker died'); }
      terminate() {}
    }
    globalThis.Worker = ThrowingWorker;
    const file = mockFile();
    file.slice = () => { throw new Error('read failed'); };

    await expect(ensureVideoInR2(file, () => {}, {})).rejects.toThrow();

    expect(beacons()).toHaveLength(1);
    expect(beacons()[0].phase).toBe('hashing');
    expect(beacons()[0].kind).toBe('game');
    expect(beacons()[0].flow_id).toEqual(expect.any(String));
  });

  it('the create-game retry beacon in uploadGame shares the flow of the upload', async () => {
    mockFetch.mockImplementation(async (url) => {
      if (String(url).endsWith('/api/games')) throw new TypeError('Failed to fetch');
      return jsonResp(200, {});
    });
    const file = mockFile();
    // Hash succeeds on a real File; only POST /api/games rejects.
    await expect(uploadGame(file, () => {}, {})).rejects.toThrow();

    const created = beacons().filter((b) => b.phase === 'creating');
    expect(created.length).toBeGreaterThan(0);
    expect(created[0].kind).toBe('game');
    expect(created[0].flow_id).toEqual(expect.any(String));
  });
});

describe('T15050 beacon client build', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockFetch.mockImplementation(async () => jsonResp(204, {}));
  });

  it('sends the build as a header, so it survives a body that never arrives', () => {
    __setClientBuildForTest(7102);

    sendUploadFailureBeacon({ phase: 'uploading', reason: 'x' });

    const [, options] = callTo('upload-failure-beacon');
    expect(options.headers['X-Client-Build']).toBe('7102');
  });
});
