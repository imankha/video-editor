import { describe, it, expect } from 'vitest';
import { isClipFromAnotherProject, shouldRetryClipVideoViaProxy } from './clipVideoResolution';

/**
 * T10740 regression: Annotate "Frame Later" -> "Frame" opened Focus on a FALSE
 * "This video is no longer available. Its source storage may have expired."
 *
 * Nothing had expired. `invalidateClips` is fire-and-forget and never clears the
 * previous project's clips, so FocusScreen's mount loader paired the OLD clip id
 * with the NEW project id -> honest 404 -> silent `/stream` retry with the same
 * impossible pair -> dead <video> src -> useVideo mislabelled the 404 as expiry.
 *
 * These pin both halves of the fix.
 */

describe('isClipFromAnotherProject (T10740 stale-clip guard)', () => {
  it('flags the exact failing case: previous project\'s clip under the new project id', () => {
    // The clips list still holds project 41's rows while the screen shows project 42.
    expect(isClipFromAnotherProject({ id: 900, project_id: 41 }, 42)).toBe(true);
  });

  it('allows a clip that belongs to the screen\'s project', () => {
    expect(isClipFromAnotherProject({ id: 901, project_id: 42 }, 42)).toBe(false);
  });

  it('does not flag a clip that carries no project_id (older cached shape)', () => {
    // The guard catches a KNOWN mismatch; it must not gate on a missing field.
    expect(isClipFromAnotherProject({ id: 902 }, 42)).toBe(false);
    expect(isClipFromAnotherProject({ id: 903, project_id: null }, 42)).toBe(false);
  });

  it('does not flag when the screen has no project id yet', () => {
    expect(isClipFromAnotherProject({ id: 904, project_id: 41 }, null)).toBe(false);
    expect(isClipFromAnotherProject({ id: 905, project_id: 41 }, undefined)).toBe(false);
  });

  it('is null-safe on a missing clip', () => {
    expect(isClipFromAnotherProject(null, 42)).toBe(false);
    expect(isClipFromAnotherProject(undefined, 42)).toBe(false);
  });
});

describe('shouldRetryClipVideoViaProxy (T10740 no silent fallback)', () => {
  it('does NOT retry the proxy on the 404 that this bug produced', () => {
    // The /stream proxy resolves the same (project_id, clip_id) pair and 404s
    // identically; retrying it is what handed <video> a dead URL.
    expect(shouldRetryClipVideoViaProxy(404)).toBe(false);
  });

  it('does NOT retry the proxy on any other 4xx', () => {
    for (const status of [400, 401, 403, 409, 422, 499]) {
      expect(shouldRetryClipVideoViaProxy(status)).toBe(false);
    }
  });

  it('DOES retry the proxy on a 5xx (the proxy is a genuinely different path)', () => {
    for (const status of [500, 502, 503]) {
      expect(shouldRetryClipVideoViaProxy(status)).toBe(true);
    }
  });

  it('DOES retry the proxy when the request threw with no response (transport failure)', () => {
    expect(shouldRetryClipVideoViaProxy(null)).toBe(true);
    expect(shouldRetryClipVideoViaProxy(undefined)).toBe(true);
  });
});
