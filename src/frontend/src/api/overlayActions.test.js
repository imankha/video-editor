import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { createRegion, deleteKeyframe, revertPoster } from './overlayActions';

/**
 * Prod report 2026-07-29 ("Keyframe at 2.0s not found").
 *
 * `createRegion` used to send bounds only, so the stored region had
 * `keyframes: []` while the editor was already showing the two boundary
 * keyframes `useHighlightRegions.addRegion` materialized. That divergence made
 * an untouched region export with no spotlight (the render endpoint skips
 * keyframe-less regions) and made the first drag near a boundary mirror a
 * snap-move as a delete of a keyframe the DB never had.
 *
 * `sendAction` must also report the HTTP status so the action store can tell a
 * dropped request (retryable) from the server's verdict on this exact request
 * (a 4xx, which re-sending can only repeat).
 */
vi.mock('../config', () => ({ API_BASE: 'http://test.local' }));

const apiFetch = vi.fn();
vi.mock('../utils/apiFetch', () => ({ default: (...args) => apiFetch(...args) }));

const bodyOf = (call) => JSON.parse(call[1].body);

const KEYFRAME = {
  time: 2.0,
  x: 540,
  y: 960,
  radiusX: 115,
  radiusY: 230,
  strokeOpacity: 0.85,
  fillOpacity: 0.05,
  color: '#FFFFFF',
};

describe('overlayActions', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const ok = (payload = { success: true, version: 1 }) =>
    apiFetch.mockResolvedValue({ ok: true, status: 200, json: async () => payload });

  it('createRegion sends the seed keyframes so the DB matches what is on screen', async () => {
    ok();

    await createRegion(7, 0, 2, 'region-abc', [{ ...KEYFRAME, time: 0 }, KEYFRAME]);

    const body = bodyOf(apiFetch.mock.calls[0]);
    expect(body.action).toBe('create_region');
    expect(body.data.region_id).toBe('region-abc');
    expect(body.data.keyframes).toHaveLength(2);
    expect(body.data.keyframes.map((kf) => kf.time)).toEqual([0, 2.0]);
  });

  it('createRegion omits the keyframes field entirely when there are none', async () => {
    ok();

    await createRegion(7, 0, 2, 'region-abc');

    expect(bodyOf(apiFetch.mock.calls[0]).data).not.toHaveProperty('keyframes');
  });

  it('surfaces the HTTP status on failure so retries can be classified', async () => {
    apiFetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ success: false, version: 4, error: 'Keyframe at 2.0s not found' }),
    });

    const result = await deleteKeyframe(7, 'region-abc', 2.0);

    expect(result).toEqual({
      success: false,
      version: 4,
      error: 'Keyframe at 2.0s not found',
      status: 400,
    });
  });

  it('a network error carries no status (it never reached the server, so it is retryable)', async () => {
    apiFetch.mockRejectedValue(new Error('Failed to fetch'));

    const result = await deleteKeyframe(7, 'region-abc', 2.0);

    expect(result.success).toBe(false);
    expect(result.status).toBeUndefined();
  });

  // T6380: Remove is a real revert, not a local-only reset. It POSTs to
  // /poster/revert (which overwrites the R2 object) and returns the resulting
  // source so the caller updates from the response, never optimistically.
  it('revertPoster POSTs to /poster/revert and returns the resulting source', async () => {
    ok({ success: true, poster_filename: 'r.mp4.jpg', poster_source: 'auto' });

    const result = await revertPoster(42);

    const [url, opts] = apiFetch.mock.calls[0];
    expect(url).toBe('http://test.local/api/export/projects/42/poster/revert');
    expect(opts.method).toBe('POST');
    expect(result).toEqual({ success: true, poster_filename: 'r.mp4.jpg', poster_source: 'auto' });
  });

  it('revertPoster surfaces the HTTP status on failure (e.g. 400 no final video)', async () => {
    apiFetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ detail: 'Project has no exported final video yet -- nothing to revert' }),
    });

    const result = await revertPoster(42);

    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/nothing to revert/);
  });
});
