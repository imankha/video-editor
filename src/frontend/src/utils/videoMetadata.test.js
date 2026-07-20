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
