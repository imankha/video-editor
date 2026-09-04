import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useClipUpload } from './useClipUpload';

vi.mock('../services/uploadManager', () => ({
  ensureVideoInR2: vi.fn(),
  uploadClipsBatch: vi.fn(),
  UPLOAD_PHASE: {
    HASHING: 'hashing',
    PREPARING: 'preparing',
    UPLOADING: 'uploading',
    FINALIZING: 'finalizing',
    COMPLETE: 'complete',
  },
}));

const selectProject = vi.fn();
const fetchProjects = vi.fn().mockResolvedValue();
vi.mock('../stores/projectsStore', () => ({
  useProjectsStore: { getState: () => ({ selectProject, fetchProjects }) },
}));

import { ensureVideoInR2, uploadClipsBatch } from '../services/uploadManager';

function makeFile(name, size = 1024) {
  return new File([new Uint8Array(size)], name, { type: 'video/mp4' });
}

describe('useClipUpload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('hashes+lands each file with kind=clip, then posts ONE batch call', async () => {
    ensureVideoInR2
      .mockResolvedValueOnce({ blake3_hash: 'hash-a', file_size: 111, uploaded: true })
      .mockResolvedValueOnce({ blake3_hash: 'hash-b', file_size: 222, uploaded: true });
    uploadClipsBatch.mockResolvedValue({
      results: [
        { ok: true, blake3_hash: 'hash-a', raw_clip_id: 1, project_id: 10 },
        { ok: true, blake3_hash: 'hash-b', raw_clip_id: 2, project_id: 11 },
      ],
      charged: 1,
      balance: 99,
    });

    const { result } = renderHook(() => useClipUpload());

    let outcome;
    await act(async () => {
      outcome = await result.current.uploadClips([makeFile('a.mp4'), makeFile('b.mp4')]);
    });

    expect(ensureVideoInR2).toHaveBeenCalledTimes(2);
    expect(ensureVideoInR2.mock.calls[0][2]).toEqual({ kind: 'clip' });
    expect(uploadClipsBatch).toHaveBeenCalledTimes(1);
    expect(uploadClipsBatch).toHaveBeenCalledWith([
      { blake3_hash: 'hash-a', file_size: 111, original_filename: 'a.mp4' },
      { blake3_hash: 'hash-b', file_size: 222, original_filename: 'b.mp4' },
    ]);
    expect(outcome.charged).toBe(1);
    expect(outcome.results).toHaveLength(2);
    expect(result.current.isUploading).toBe(false);
  });

  it('selects the first created project and force-refreshes (announceReelCreated contract)', async () => {
    ensureVideoInR2.mockResolvedValue({ blake3_hash: 'hash-a', file_size: 111, uploaded: true });
    uploadClipsBatch.mockResolvedValue({
      results: [{ ok: true, blake3_hash: 'hash-a', raw_clip_id: 1, project_id: 42 }],
      charged: 1,
      balance: 5,
    });

    const { result } = renderHook(() => useClipUpload());
    await act(async () => {
      await result.current.uploadClips([makeFile('a.mp4')]);
    });

    expect(selectProject).toHaveBeenCalledWith(42);
    expect(fetchProjects).toHaveBeenCalledWith({ force: true });
  });

  it('a per-file R2 landing failure does not block its siblings (partial failure)', async () => {
    ensureVideoInR2
      .mockRejectedValueOnce(new Error('source_missing'))
      .mockResolvedValueOnce({ blake3_hash: 'hash-b', file_size: 222, uploaded: true });
    uploadClipsBatch.mockResolvedValue({
      results: [{ ok: true, blake3_hash: 'hash-b', raw_clip_id: 2, project_id: 20 }],
      charged: 1,
      balance: 5,
    });

    const { result } = renderHook(() => useClipUpload());

    let outcome;
    await act(async () => {
      outcome = await result.current.uploadClips([makeFile('bad.mp4'), makeFile('b.mp4')]);
    });

    // Only the surviving file reaches the batch call.
    expect(uploadClipsBatch).toHaveBeenCalledWith([
      { blake3_hash: 'hash-b', file_size: 222, original_filename: 'b.mp4' },
    ]);
    expect(outcome.results.some((r) => r.original_filename === 'bad.mp4' && r.ok === false)).toBe(true);
    expect(outcome.results.some((r) => r.blake3_hash === 'hash-b' && r.ok === true)).toBe(true);
  });

  it('never calls the batch endpoint when every file fails to land in R2', async () => {
    ensureVideoInR2.mockRejectedValue(new Error('network'));

    const { result } = renderHook(() => useClipUpload());

    let outcome;
    await act(async () => {
      outcome = await result.current.uploadClips([makeFile('a.mp4')]);
    });

    expect(uploadClipsBatch).not.toHaveBeenCalled();
    expect(result.current.error).toBeTruthy();
    expect(outcome.charged).toBe(0);
  });
});
