/**
 * T7480: stall-watchdog + honest-progress unit tests for the upload part path.
 *
 * The prod outage was a flat per-part timeout killing a healthy-but-slow transfer
 * and a progress bar driven by BUFFERED bytes (which climbed while the socket was
 * dead). These tests pin the two behaviors that replace that.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { uploadPart, uploadParts } from './uploadManager';

// A controllable XMLHttpRequest stand-in. Handlers are assigned by uploadPart
// before send(); tests drive onprogress / onload / onerror manually.
let xhrs = [];
class MockXHR {
  constructor() {
    this.upload = {};
    this._headers = {};
    this.status = 0;
  }
  open() {}
  getResponseHeader(k) { return this._headers[k]; }
  send() { xhrs.push(this); }
  abort() { this.aborted = true; if (this.onabort) this.onabort(); }
}

const FILE = { slice: () => 'blob-bytes' };

beforeEach(() => {
  xhrs = [];
  globalThis.XMLHttpRequest = MockXHR;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('T7480 stall watchdog (uploadPart)', () => {
  it('aborts a part after a stall with zero progress (retryable "stalled")', async () => {
    vi.useFakeTimers();
    const p = uploadPart(FILE, {
      part_number: 1, presigned_url: 'https://r2/p1', start_byte: 0, end_byte: 1023,
    }, null);
    const assertion = expect(p).rejects.toThrow(/stalled/);

    // No onprogress ever fires. Advance well past the stall timeout (30s) plus a
    // watchdog check interval (5s).
    await vi.advanceTimersByTimeAsync(40_000);
    await assertion;
    expect(xhrs[0].aborted).toBe(true);
  });

  it('does NOT abort while progress keeps flowing, then resolves on 2xx', async () => {
    vi.useFakeTimers();
    const p = uploadPart(FILE, {
      part_number: 7, presigned_url: 'https://r2/p7', start_byte: 0, end_byte: 4095,
    }, null);
    const xhr = xhrs[0];

    // Progress every 10s (< 30s stall) five times => timer keeps resetting.
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(10_000);
      xhr.upload.onprogress({ lengthComputable: true, loaded: (i + 1) * 800, total: 4096 });
    }
    expect(xhr.aborted).toBeUndefined();

    // Now complete successfully.
    xhr.status = 200;
    xhr._headers.ETag = '"etag-7"';
    xhr.onload();
    await expect(p).resolves.toEqual({ part_number: 7, etag: '"etag-7"' });
    expect(xhr.aborted).toBeUndefined();
  });

  it('rejects a non-2xx response without aborting', async () => {
    const p = uploadPart(FILE, {
      part_number: 2, presigned_url: 'https://r2/p2', start_byte: 0, end_byte: 1023,
    }, null);
    const xhr = xhrs[0];
    xhr.status = 403;
    xhr.onload();
    await expect(p).rejects.toThrow(/upload failed: 403/);
  });
});

describe('T7480 honest progress (uploadParts)', () => {
  it('reports percent from COMPLETED parts, never from buffered bytes', async () => {
    const MB = 1024 * 1024;
    const parts = [
      { part_number: 1, presigned_url: 'u1', start_byte: 0, end_byte: 5 * MB - 1 },
      { part_number: 2, presigned_url: 'u2', start_byte: 5 * MB, end_byte: 10 * MB - 1 },
    ];
    const progress = [];
    const onProgress = (p) => progress.push(p);

    // sessionId=null so no resume-state PATCH fires (no apiFetch needed).
    const promise = uploadParts(FILE, parts, onProgress, null, [], 10 * MB, 2, null);

    // Let both parts start (concurrency 2).
    await Promise.resolve();
    await Promise.resolve();
    expect(xhrs.length).toBe(2);

    // Fire a full buffer of progress on part 1 WITHOUT completing it. Honest
    // progress must ignore buffered bytes -> bar stays untouched.
    xhrs[0].upload.onprogress({ lengthComputable: true, loaded: 5 * MB, total: 5 * MB });
    expect(progress).toEqual([]);

    // Complete part 1 -> 50%.
    xhrs[0].status = 200;
    xhrs[0]._headers.ETag = '"e1"';
    xhrs[0].onload();
    await new Promise((r) => setTimeout(r, 0));
    expect(progress).toContain(50);

    // Complete part 2 -> 100%.
    xhrs[1].status = 200;
    xhrs[1]._headers.ETag = '"e2"';
    xhrs[1].onload();

    const result = await promise;
    expect(progress[progress.length - 1]).toBe(100);
    expect(result.map((r) => r.part_number).sort()).toEqual([1, 2]);
  });
});
