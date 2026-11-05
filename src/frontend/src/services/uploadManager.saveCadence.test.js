/**
 * T15030: resume-state saves must not be one PATCH per 5 MB part.
 * A 15 MB clip (3 parts) queued 3 PATCHes behind the per-user lock (16 s waits,
 * 2026-11-04). T15090 took PATCH /parts off that lock; the cadence stays.
 * Cadence: one save per SAVE_BATCH_SIZE parts, plus a final save for the remainder.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const apiFetchMock = vi.fn();
vi.mock('../utils/apiFetch', () => ({ default: (...a) => apiFetchMock(...a) }));

import { uploadParts } from './uploadManager';

let xhrs = [];
class MockXHR {
  constructor() { this.upload = {}; this._headers = {}; this.status = 0; }
  open() {}
  getResponseHeader(k) { return this._headers[k]; }
  send() {
    xhrs.push(this);
    queueMicrotask(() => {
      this.status = 200;
      this._headers.ETag = `"e${xhrs.length}"`;
      this.onload();
    });
  }
  abort() {}
}
const FILE = { slice: () => 'blob-bytes' };
const MB = 1024 * 1024;
const mkParts = (n) => Array.from({ length: n }, (_, i) => ({
  part_number: i + 1, presigned_url: `u${i + 1}`,
  start_byte: i * 5 * MB, end_byte: (i + 1) * 5 * MB - 1,
}));

beforeEach(() => {
  xhrs = [];
  apiFetchMock.mockReset();
  apiFetchMock.mockResolvedValue({ ok: true });
  globalThis.XMLHttpRequest = MockXHR;
});

const patchCalls = () => apiFetchMock.mock.calls.filter(([, o]) => o?.method === 'PATCH');

describe('T15030 resume-state save cadence', () => {
  it('a 3-part clip upload sends ONE parts PATCH (final save only)', async () => {
    const res = await uploadParts(FILE, mkParts(3), null, 'sess', [], 15 * MB, 2, null);
    expect(res).toHaveLength(3);
    expect(patchCalls()).toHaveLength(1);
    const body = JSON.parse(patchCalls()[0][1].body);
    expect(body.parts.map((p) => p.part_number).sort()).toEqual([1, 2, 3]);
  });

  it('a large upload still saves in batches so resume loses at most one batch', async () => {
    await uploadParts(FILE, mkParts(40), null, 'sess', [], 200 * MB, 2, null);
    const n = patchCalls().length;
    expect(n).toBeGreaterThan(1);
    expect(n).toBeLessThan(10);
    const saved = patchCalls().flatMap(([, o]) => JSON.parse(o.body).parts.map((p) => p.part_number));
    expect(saved.sort((a, b) => a - b)).toEqual(Array.from({ length: 40 }, (_, i) => i + 1));
  });
});
