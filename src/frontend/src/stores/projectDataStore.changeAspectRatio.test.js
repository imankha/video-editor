import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock config + apiFetch before importing the store.
vi.mock('../config', () => ({ API_BASE: '' }));

const mockApiFetch = vi.fn();
vi.mock('../utils/apiFetch', () => ({ default: (...args) => mockApiFetch(...args) }));

import { useProjectDataStore } from './projectDataStore';
import { useProjectsStore } from './projectsStore';

/**
 * T3910: changeAspectRatio is the surgical reel-level gesture. It POSTs only the new ratio.
 * T10990: that POST is the only request. The ratio is applied to the selected project at once
 * (reverted if the POST fails) and the re-fit crops come back in the POST's answer.
 */
describe('projectDataStore.changeAspectRatio (T3910)', () => {
  const PORTRAIT_CROP = [{ frame: 0, x: 800, y: 0, width: 608, height: 1080 }];

  beforeEach(() => {
    mockApiFetch.mockReset();
    useProjectDataStore.setState({
      clips: [
        { id: 1, name: 'Play', width: 1920, height: 1080, crop_data: PORTRAIT_CROP },
        { id: 2, name: 'Other', width: 1920, height: 1080, crop_data: null },
      ],
      _clipsInflight: null, projectClipId: null,
    });
    useProjectsStore.setState({ selectedProjectId: 42, selectedProject: { id: 42, name: 'Reel', aspect_ratio: '9:16' } });
  });

  it('T10990: switches in one POST and takes the re-fit crops from its answer', async () => {
    const refit = [{ frame: 0, x: 320, y: 180, width: 1280, height: 720 }];
    mockApiFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, aspect_ratio: '16:9', updated_clip_count: 1, clips: [{ id: 1, crop_data: refit }] }),
    });

    const result = await useProjectDataStore.getState().changeAspectRatio(42, '16:9');

    expect(result.success).toBe(true);
    expect(mockApiFetch).toHaveBeenCalledTimes(1); // no clip refetch
    const [url, opts] = mockApiFetch.mock.calls[0];
    expect(url).toContain('/clips/projects/42/aspect-ratio');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual({ aspect_ratio: '16:9' }); // surgical
    // The crop the editor shows is exactly the crop the server stored; other fields kept.
    expect(useProjectDataStore.getState().clips).toEqual([{ id: 1, name: 'Play', width: 1920, height: 1080, crop_data: refit }, { id: 2, name: 'Other', width: 1920, height: 1080, crop_data: null }]);
    expect(useProjectsStore.getState().selectedProject.aspect_ratio).toBe('16:9');
  });

  it('T10990: the frame changes shape before the POST answers', async () => {
    let answer;
    mockApiFetch.mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));

    const pending = useProjectDataStore.getState().changeAspectRatio(42, '16:9');

    expect(useProjectsStore.getState().selectedProject.aspect_ratio).toBe('16:9');
    // The box is re-fit in memory around the same center (1104, 540) until the server's answer.
    expect(useProjectDataStore.getState().clips[0].crop_data).toEqual([{ frame: 0, x: 464, y: 180, width: 1280, height: 720 }]);
    answer({ ok: true, json: () => Promise.resolve({ success: true, aspect_ratio: '16:9', updated_clip_count: 0, clips: [] }) });
    await pending;
    expect(useProjectsStore.getState().selectedProject.aspect_ratio).toBe('16:9');
  });

  it('T10990: reverts the shape and keeps the crops when the backend rejects the ratio', async () => {
    mockApiFetch.mockResolvedValueOnce({ ok: false, status: 400, json: () => Promise.resolve({ error: 'Invalid aspect ratio' }) });

    const result = await useProjectDataStore.getState().changeAspectRatio(42, '16:9');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Invalid aspect ratio');
    expect(mockApiFetch).toHaveBeenCalledTimes(1);
    expect(useProjectsStore.getState().selectedProject.aspect_ratio).toBe('9:16');
    expect(useProjectDataStore.getState().clips[0].crop_data).toEqual(PORTRAIT_CROP);
  });

  it('T10990: reverts the shape when the request never answers (network error)', async () => {
    mockApiFetch.mockRejectedValueOnce(new Error('Failed to fetch'));

    const result = await useProjectDataStore.getState().changeAspectRatio(42, '16:9');

    expect(result.success).toBe(false);
    expect(useProjectsStore.getState().selectedProject.aspect_ratio).toBe('9:16');
  });

  it('returns failure without an API call when projectId is missing', async () => {
    const result = await useProjectDataStore.getState().changeAspectRatio(null, '16:9');
    expect(result.success).toBe(false);
    expect(mockApiFetch).not.toHaveBeenCalled();
  });
});
