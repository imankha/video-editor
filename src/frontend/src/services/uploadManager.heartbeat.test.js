/**
 * T15130: a slow upload saves rarely, so prepare-upload's 60 s liveness window would
 * expire mid-upload. uploadParts must ping /upload-heartbeat inside the window while
 * parts are in flight, and stop pinging once it returns.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const apiFetchMock = vi.fn();
vi.mock('../utils/apiFetch', () => ({ default: (...a) => apiFetchMock(...a) }));

import { uploadParts } from './uploadManager';

let pending = [];
class HangingXHR {
  constructor() { this.upload = {}; this._headers = {}; this.status = 0; }
  open() {}
  getResponseHeader(k) { return this._headers[k]; }
  send() { pending.push(this); }
  abort() {}
  finish() { this.status = 200; this._headers.ETag = '"e"'; this.onload(); }
}
const FILE = { slice: () => 'blob-bytes' };
const MB = 1024 * 1024;
const PARTS = [{ part_number: 1, presigned_url: 'u1', start_byte: 0, end_byte: 5 * MB - 1 }];
const beats = () => apiFetchMock.mock.calls.filter(([u]) => String(u).endsWith('/api/games/upload-heartbeat'));

beforeEach(() => {
  vi.useFakeTimers();
  pending = [];
  apiFetchMock.mockReset();
  apiFetchMock.mockResolvedValue({ ok: true });
  globalThis.XMLHttpRequest = HangingXHR;
});
afterEach(() => vi.useRealTimers());

describe('T15130 upload heartbeat', () => {
  it('pings while a part is in flight, well inside the 60 s window, and stops after', async () => {
    const run = uploadParts(FILE, PARTS, null, 'sess', [], 5 * MB, 1, null);
    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(5_000);
      pending[0].upload.onprogress?.({ lengthComputable: true, loaded: i, total: 100 });
    }
    expect(beats().length).toBeGreaterThanOrEqual(3);
    expect(JSON.parse(beats()[0][1].body)).toEqual({ session_id: 'sess' });
    pending[0].finish();
    await run;
    const n = beats().length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(beats()).toHaveLength(n);
  });
});
