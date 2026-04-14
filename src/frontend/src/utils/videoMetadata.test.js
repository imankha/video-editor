/**
 * T1490: extractVideoMetadataFromUrl must set crossOrigin='use-credentials'
 * on same-origin proxy URLs, so the detached <video> probe sends the session
 * cookie. Presigned R2 (cross-origin) URLs must NOT get credentials.
 *
 * These tests capture the <video> element created inside the function by
 * spying on document.createElement. The returned Promise never resolves in
 * jsdom (no network, no loadedmetadata event), so we assert synchronously
 * right after calling — before awaiting.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { extractVideoMetadataFromUrl, shouldProbeClipMetadata } from './videoMetadata';

describe('T1500 shouldProbeClipMetadata', () => {
  it('returns false when clip has width, height, and fps', () => {
    expect(shouldProbeClipMetadata({ width: 1920, height: 1080, fps: 30 })).toBe(false);
  });

  it('returns true when width is missing', () => {
    expect(shouldProbeClipMetadata({ width: null, height: 1080, fps: 30 })).toBe(true);
  });

  it('returns true when height is missing', () => {
    expect(shouldProbeClipMetadata({ width: 1920, height: null, fps: 30 })).toBe(true);
  });

  it('returns true when fps is missing', () => {
    expect(shouldProbeClipMetadata({ width: 1920, height: 1080, fps: null })).toBe(true);
  });

  it('returns true when any dim is 0 (treated as missing)', () => {
    expect(shouldProbeClipMetadata({ width: 0, height: 1080, fps: 30 })).toBe(true);
  });

  it('returns true when clip is undefined', () => {
    expect(shouldProbeClipMetadata(undefined)).toBe(true);
  });
});

describe('T1490 extractVideoMetadataFromUrl crossOrigin', () => {
  let createdVideo;
  let origCreateElement;

  beforeEach(() => {
    createdVideo = null;
    origCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag, options) => {
      const el = origCreateElement(tag, options);
      if (tag === 'video') {
        createdVideo = el;
      }
      return el;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sets crossOrigin="use-credentials" on same-origin /api proxy URLs', () => {
    // Don't await — promise never resolves in jsdom.
    extractVideoMetadataFromUrl('/api/clips/projects/1/clips/1/stream').catch(() => {});
    expect(createdVideo).not.toBeNull();
    expect(createdVideo.crossOrigin).toBe('use-credentials');
  });

  it('sets crossOrigin="use-credentials" on absolute same-origin URL', () => {
    const url = window.location.origin + '/api/clips/projects/1/clips/2/stream';
    extractVideoMetadataFromUrl(url).catch(() => {});
    expect(createdVideo).not.toBeNull();
    expect(createdVideo.crossOrigin).toBe('use-credentials');
  });

  it('does NOT set crossOrigin for cross-origin presigned R2 URLs', () => {
    extractVideoMetadataFromUrl('https://r2.example.com/clip.mp4?sig=abc').catch(() => {});
    expect(createdVideo).not.toBeNull();
    // Either empty string (HTML spec default when unset) or null/undefined —
    // the important thing is that it is NOT 'use-credentials' or 'anonymous'.
    const co = createdVideo.crossOrigin;
    expect(co === '' || co === null || co === undefined).toBe(true);
  });
});
