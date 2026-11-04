/**
 * T15020: two flows uploading the SAME file at once (a second clip batch picked
 * while the first was still running, prod 2026-11-04) share one upload session
 * via prepare-upload's resume branch. The flow that finishes second used to
 * fail three ways: its part PUTs 404 (NoSuchUpload) once the other flow
 * completed the multipart, its finalize 404s (pending row already deleted), and
 * the server recorded each as a terminal game-upload failure.
 *
 * Client side of the fix, pinned here:
 *   - finalize-upload carries blake3_hash + kind so the server can answer a
 *     duplicate finalize with the durable outcome instead of a 404;
 *   - a part PUT 404 re-runs prepare-upload once: an EXISTS answer means the
 *     other flow landed the bytes, so the file resolves as uploaded (dedup),
 *     with no failure beacon.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ensureVideoInR2 } from './uploadManager';

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

const HASH = 'b'.repeat(64);
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

const jsonResp = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

function makeXHR(status) {
  return class MockXHR {
    constructor() {
      this.upload = {};
      this.status = 200;
    }
    open() {}
    getResponseHeader(name) {
      return name === 'ETag' ? '"mock-etag"' : null;
    }
    send() {
      setTimeout(() => {
        if (this.upload.onprogress) {
          this.upload.onprogress({ lengthComputable: true, loaded: 4, total: 4 });
        }
        this.status = status;
        if (this.onload) this.onload();
      }, 0);
    }
  };
}

const PRECOMPUTED = { blake3_hash: HASH, faststartInfo: { needsRelocation: false } };
const mockFile = () => new File(['test'], 'clip.mp4', { type: 'video/mp4' });

const uploadRequired = () => jsonResp(200, {
  status: 'upload_required',
  upload_session_id: 'sess_shared',
  parts: [{ part_number: 1, presigned_url: 'https://r2/put', start_byte: 0, end_byte: 3 }],
});

describe('T15020 concurrent flows for one file', () => {
  let errorSpy;
  let warnSpy;
  beforeEach(() => {
    vi.resetAllMocks();
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('finalize-upload carries the blake3_hash and kind the server needs to answer a duplicate', async () => {
    globalThis.XMLHttpRequest = makeXHR(200);
    mockFetch.mockImplementation(async (url) => {
      if (url.includes('/prepare-upload')) return uploadRequired();
      if (url.includes('/finalize-upload')) return jsonResp(200, { blake3_hash: HASH, file_size: 4, kind: 'clip' });
      return jsonResp(200, {});
    });

    const result = await ensureVideoInR2(mockFile(), () => {}, { kind: 'clip', precomputed: PRECOMPUTED });

    expect(result.uploaded).toBe(true);
    const finalizeCall = mockFetch.mock.calls.find(([u]) => String(u).includes('/finalize-upload'));
    expect(finalizeCall).toBeTruthy();
    const body = JSON.parse(finalizeCall[1].body);
    expect(body.upload_session_id).toBe('sess_shared');
    expect(body.blake3_hash).toBe(HASH);
    expect(body.kind).toBe('clip');
  });

  it('a part PUT 404 re-prepares once and resolves as already uploaded when the other flow landed the bytes', async () => {
    globalThis.XMLHttpRequest = makeXHR(404);
    let prepareCalls = 0;
    mockFetch.mockImplementation(async (url) => {
      if (url.includes('/prepare-upload')) {
        prepareCalls += 1;
        // First prepare: resume into the shared session. Second (after the 404):
        // the other flow has finalized, the object exists -> dedup answer.
        return prepareCalls === 1
          ? uploadRequired()
          : jsonResp(200, { status: 'exists', blake3_hash: HASH, file_size: 4 });
      }
      if (url.includes('/finalize-upload')) throw new Error('finalize must not run for a dedup-resolved flow');
      return jsonResp(200, {});
    });

    const phases = [];
    const result = await ensureVideoInR2(mockFile(), (p) => phases.push(p.phase), { kind: 'clip', precomputed: PRECOMPUTED });

    expect(prepareCalls).toBe(2);
    expect(result).toMatchObject({ blake3_hash: HASH, file_size: 4, uploaded: false });
    expect(phases[phases.length - 1]).toBe('complete');
    const beacons = mockFetch.mock.calls.filter(([u]) => String(u).includes('upload-failure-beacon'));
    expect(beacons).toEqual([]);
  });

  it('a part PUT 404 with no landed object still fails with the r2_rejected beacon', async () => {
    globalThis.XMLHttpRequest = makeXHR(404);
    mockFetch.mockImplementation(async (url) => {
      if (url.includes('/prepare-upload')) return uploadRequired();
      return jsonResp(200, {});
    });

    await expect(
      ensureVideoInR2(mockFile(), () => {}, { kind: 'clip', precomputed: PRECOMPUTED })
    ).rejects.toThrow(/upload failed: 404/);

    const beacon = mockFetch.mock.calls.find(([u]) => String(u).includes('upload-failure-beacon'));
    expect(beacon).toBeTruthy();
    const payload = JSON.parse(beacon[1].body);
    expect(payload.phase).toBe('uploading');
    expect(payload.reason).toMatch(/upload failed: 404/);
    expect(payload.kind).toBe('clip');
  });
});
