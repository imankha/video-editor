/**
 * T1490: extractVideoMetadataFromUrl must send session cookies on same-origin
 * proxy URLs (/api/...) so the backend can authenticate. Cross-origin presigned
 * R2 URLs must NOT send credentials (auth is baked into the URL; credentials
 * would trigger CORS rejection).
 *
 * The function uses fetch() instead of a <video> element — cross-origin
 * `<video>` element fetches get classified as Low-priority media by Chrome
 * and stall ~15s in _blocked_queueing before dispatching. fetch() is script
 * priority (High) and dispatches immediately. So the credential-handling
 * assertion is now on the fetch() call options.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { extractVideoMetadataFromUrl, VideoAssetMissingError } from './videoMetadata';

// --- T8800: synthetic MP4 box builders for creation-time parse tests ---------
function u32(n) {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0, false);
  return b;
}
function u64(n) {
  const b = new Uint8Array(8);
  const dv = new DataView(b.buffer);
  dv.setUint32(0, Math.floor(n / 0x100000000), false);
  dv.setUint32(4, n >>> 0, false);
  return b;
}
function concat(...arrs) {
  const total = arrs.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}
function box(type, payload) {
  const out = new Uint8Array(8 + payload.length);
  new DataView(out.buffer).setUint32(0, out.length, false);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(payload, 8);
  return out;
}
const MP4_EPOCH_OFFSET_S = 2082844800;
const mvhdV0 = (creation, timescale, duration) =>
  box('mvhd', concat(new Uint8Array([0, 0, 0, 0]), u32(creation), u32(0), u32(timescale), u32(duration)));
const mvhdV1 = (creation, timescale, duration) =>
  box('mvhd', concat(new Uint8Array([1, 0, 0, 0]), u64(creation), u64(0), u32(timescale), u64(duration)));
const tkhdV0 = (w, h) =>
  box('tkhd', concat(new Uint8Array(4 + 8 + 4 + 4 + 4 + 8 + 8 + 36), u32(w * 65536), u32(h * 65536)));
const buildMp4 = (mvhd) =>
  concat(box('ftyp', concat(new Uint8Array([0x69, 0x73, 0x6f, 0x6d]), u32(0))),
         box('moov', concat(mvhd, box('trak', tkhdV0(1920, 1080)))));

function mockFetchBuffer(buf) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(buf, { status: 206, headers: { 'Content-Range': `bytes 0-${buf.length - 1}/${buf.length}` } })
  );
}

describe('T1490 extractVideoMetadataFromUrl fetch credentials', () => {
  let fetchSpy;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      // Return a response that will fail moov parse so the function rejects
      // quickly — we only need to observe fetch options.
      Promise.resolve(new Response(new ArrayBuffer(0), { status: 206, headers: { 'Content-Range': 'bytes 0-0/1' } }))
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends credentials:"include" on same-origin /api proxy URLs', async () => {
    await extractVideoMetadataFromUrl('/api/clips/projects/1/clips/1/stream').catch(() => {});
    expect(fetchSpy).toHaveBeenCalled();
    const [, opts] = fetchSpy.mock.calls[0];
    expect(opts?.credentials).toBe('include');
  });

  it('sends credentials:"include" on absolute same-origin URL', async () => {
    const url = window.location.origin + '/api/clips/projects/1/clips/2/stream';
    await extractVideoMetadataFromUrl(url).catch(() => {});
    expect(fetchSpy).toHaveBeenCalled();
    const [, opts] = fetchSpy.mock.calls[0];
    expect(opts?.credentials).toBe('include');
  });

  it('does NOT send credentials for cross-origin presigned R2 URLs', async () => {
    await extractVideoMetadataFromUrl('https://r2.example.com/clip.mp4?sig=abc').catch(() => {});
    expect(fetchSpy).toHaveBeenCalled();
    const [, opts] = fetchSpy.mock.calls[0];
    expect(opts?.credentials).toBeUndefined();
  });
});

/**
 * T5440: a hard 404/410 (asset genuinely gone) must throw a typed
 * VideoAssetMissingError and must NOT run the diagnostic probe storm (a second
 * HEAD + head-range + tail-range, each another 404). A transient 5xx keeps the
 * old diagnostic path so a retry is still valid.
 */
describe('T5440 extractVideoMetadataFromUrl missing-asset handling', () => {
  let fetchSpy;
  let warnSpy;
  let errorSpy;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throws VideoAssetMissingError on a hard 404 with assetMissing + status', async () => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{"detail":"R2 returned 404"}', { status: 404 })
    );
    await expect(
      extractVideoMetadataFromUrl('/api/projects/29/working_video/stream')
    ).rejects.toMatchObject({ assetMissing: true, status: 404 });
  });

  it('does NOT run the diagnostic probe storm on a 404 (single fetch, no console.error)', async () => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{"detail":"R2 returned 404"}', { status: 404 })
    );
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await extractVideoMetadataFromUrl('/api/projects/29/working_video/stream').catch(() => {});

    // Only the initial head-range GET — failWithDiagnostic/probeVideoStructure
    // (which would add HEAD + head-range + tail-range) must be skipped.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    // One concise warn, and NOT the per-attempt "[videoMetadata] FAIL" error flood.
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('410 Gone is also treated as a missing asset', async () => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('gone', { status: 410 })
    );
    await expect(
      extractVideoMetadataFromUrl('/api/projects/29/working_video/stream')
    ).rejects.toBeInstanceOf(VideoAssetMissingError);
  });

  it('a transient 5xx is NOT a missing asset and still runs the diagnostic probe', async () => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('boom', { status: 503 })
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    let caught;
    await extractVideoMetadataFromUrl('/api/projects/29/working_video/stream').catch((e) => { caught = e; });

    expect(caught).toBeDefined();
    expect(caught).not.toBeInstanceOf(VideoAssetMissingError);
    expect(caught?.assetMissing).toBeFalsy();
    // failWithDiagnostic -> probeVideoStructure fired additional probe fetches.
    expect(fetchSpy.mock.calls.length).toBeGreaterThan(1);
  });
});

/**
 * T8800: the mvhd walker now also returns the embedded creation time. It must
 * keep extracting duration/dimensions exactly as before (regression) and read
 * the creation field from both version-0 (32-bit) and version-1 (64-bit) boxes,
 * treating a zero value as "not set" (null), never a literal 1904 date.
 */
describe('T8800 extractVideoMetadataFromUrl creationTime', () => {
  afterEach(() => vi.restoreAllMocks());

  // 2026-09-05T17:55:44Z expressed in the MP4 epoch (seconds since 1904-01-01).
  const unixSec = Math.floor(Date.UTC(2026, 8, 5, 17, 55, 44) / 1000);
  const mp4Sec = unixSec + MP4_EPOCH_OFFSET_S;

  it('reads creationTime from a version-0 mvhd and still returns duration/dims', async () => {
    mockFetchBuffer(buildMp4(mvhdV0(mp4Sec, 1000, 5000)));
    const meta = await extractVideoMetadataFromUrl('/api/clip/stream', 'DJI_0003.MP4');
    expect(meta.duration).toBe(5); // 5000 / 1000
    expect(meta.width).toBe(1920);
    expect(meta.height).toBe(1080);
    expect(meta.creationTime).toBeInstanceOf(Date);
    expect(meta.creationTime.getTime()).toBe(unixSec * 1000);
  });

  it('reads creationTime from a version-1 (64-bit) mvhd', async () => {
    mockFetchBuffer(buildMp4(mvhdV1(mp4Sec, 1000, 10000)));
    const meta = await extractVideoMetadataFromUrl('/api/clip/stream', 'x.MP4');
    expect(meta.duration).toBe(10);
    expect(meta.creationTime.getTime()).toBe(unixSec * 1000);
  });

  it('treats a zero creation value as missing (null), never 1904', async () => {
    mockFetchBuffer(buildMp4(mvhdV0(0, 1000, 5000)));
    const meta = await extractVideoMetadataFromUrl('/api/clip/stream', 'x.MP4');
    expect(meta.duration).toBe(5);
    expect(meta.creationTime).toBeNull();
  });
});
