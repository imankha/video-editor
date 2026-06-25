import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock config + apiFetch before importing the store.
vi.mock('../config', () => ({ API_BASE: '' }));

const mockApiFetch = vi.fn();
vi.mock('../utils/apiFetch', () => ({ default: (...args) => mockApiFetch(...args) }));

/**
 * T3910: changeAspectRatio is the surgical reel-level gesture. It POSTs only the new ratio,
 * then refreshes the clip list so the store holds the authoritative server-side re-fit.
 */
describe('projectDataStore.changeAspectRatio (T3910)', () => {
  let useProjectDataStore;

  beforeEach(async () => {
    vi.resetModules();
    mockApiFetch.mockReset();
    const mod = await import('./projectDataStore');
    useProjectDataStore = mod.useProjectDataStore;
    useProjectDataStore.setState({ clips: [], aspectRatio: '9:16', _clipsInflight: null, selectedClipId: null });
  });

  it('POSTs the new ratio, updates globalAspectRatio, and refreshes clips', async () => {
    const refitClips = [{ id: 1, crop_data: [{ frame: 0, x: 640, y: 360, width: 640, height: 360 }] }];
    mockApiFetch
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ success: true, aspect_ratio: '16:9', updated_clip_count: 1 }) }) // POST
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(refitClips) }); // fetchClips GET

    const result = await useProjectDataStore.getState().changeAspectRatio(42, '16:9');

    expect(result.success).toBe(true);
    expect(result.updated_clip_count).toBe(1);

    // POST body carried ONLY the ratio (surgical).
    const [url, opts] = mockApiFetch.mock.calls[0];
    expect(url).toContain('/clips/projects/42/aspect-ratio');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual({ aspect_ratio: '16:9' });

    const state = useProjectDataStore.getState();
    expect(state.aspectRatio).toBe('16:9');
    expect(state.clips).toEqual(refitClips); // refreshed from server
  });

  it('does not change ratio or refetch when the backend rejects the ratio', async () => {
    mockApiFetch.mockResolvedValueOnce({ ok: false, status: 400, json: () => Promise.resolve({ error: 'Invalid aspect ratio' }) });

    const result = await useProjectDataStore.getState().changeAspectRatio(42, 'banana');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Invalid aspect ratio');
    expect(useProjectDataStore.getState().aspectRatio).toBe('9:16'); // unchanged
    expect(mockApiFetch).toHaveBeenCalledTimes(1); // no fetchClips
  });

  it('returns failure without an API call when projectId is missing', async () => {
    const result = await useProjectDataStore.getState().changeAspectRatio(null, '16:9');
    expect(result.success).toBe(false);
    expect(mockApiFetch).not.toHaveBeenCalled();
  });
});
