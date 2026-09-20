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

  // T10740 review finding (BLOCKING): `selectedProjectId` is a STRING on the
  // auth-return and payment-return paths (sessionStorage -> selectProject stores
  // it verbatim), while clip rows carry a numeric project_id. A strict !== would
  // call every clip foreign and leave Focus permanently blank there — and the
  // payment path auto-exports, so blank crop hooks would get persisted.
  it('treats a string projectId as equal to the numeric project_id it denotes', () => {
    expect(isClipFromAnotherProject({ id: 906, project_id: 42 }, '42')).toBe(false);
  });

  it('still flags a genuine mismatch when the ids are differently typed', () => {
    expect(isClipFromAnotherProject({ id: 907, project_id: 41 }, '42')).toBe(true);
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

  // T10740 review finding (MAJOR): a blanket no-fallback-on-4xx rule would break
  // pre-T80 legacy videos. playback-url 422s when the game video has no blake3
  // hash, BEFORE presigning; /stream has no such check and presigns the old
  // per-user {user}/games/{filename} object instead. For those rows the proxy is
  // the path that works, so 422 MUST keep falling back.
  it('DOES retry the proxy on 422 (legacy blake3-less video the proxy can still serve)', () => {
    expect(shouldRetryClipVideoViaProxy(422)).toBe(true);
  });

  it('only 404 suppresses the fallback — the one status both endpoints provably share', () => {
    for (const status of [400, 401, 403, 409, 499]) {
      expect(shouldRetryClipVideoViaProxy(status)).toBe(true);
    }
  });

  it('does not suppress the fallback on 410 (handled earlier as source_expired)', () => {
    // Pinned so a reordering that let 410 reach this predicate can't silently
    // start proxy-retrying a genuinely expired source.
    expect(shouldRetryClipVideoViaProxy(410)).toBe(true);
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
