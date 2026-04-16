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
import { extractVideoMetadataFromUrl } from './videoMetadata';

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
