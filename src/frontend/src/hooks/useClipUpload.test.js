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

  // T9640 regression guard: a direct clip upload must reach framing (Focus) as a
  // standalone clip project and must NEVER route through game creation. The clip
  // path is defined by (a) landing the source as kind:'clip' (not game footage),
  // (b) finalizing through the clips endpoint (uploadClipsBatch = POST
  // /api/clips/upload), never a game activate/create call, and (c) selecting the
  // created project so Focus unlocks. If a future refactor accidentally sent a
  // direct clip through the game pipeline, one of these three would break.
  it('reaches framing (selects the clip project) without creating a game — T9640', async () => {
    ensureVideoInR2.mockResolvedValue({ blake3_hash: 'hash-solo', file_size: 333, uploaded: true });
    uploadClipsBatch.mockResolvedValue({
      results: [{ ok: true, blake3_hash: 'hash-solo', raw_clip_id: 9, project_id: 77 }],
      charged: 2,
      balance: 40,
    });

    const { result } = renderHook(() => useClipUpload());
    let outcome;
    await act(async () => {
      outcome = await result.current.uploadClips([makeFile('solo.mp4')]);
    });

    // (a) uploaded as a CLIP source, never game footage.
    expect(ensureVideoInR2.mock.calls[0][2]).toEqual({ kind: 'clip' });
    // (b) finalized through the clips batch endpoint only — the game pipeline is
    // a different call the clip path never touches.
    expect(uploadClipsBatch).toHaveBeenCalledTimes(1);
    // (c) the created clip project is selected + the list force-refreshed, which is
    // exactly how Focus (framing) unlocks for the new draft.
    expect(selectProject).toHaveBeenCalledWith(77);
    expect(fetchProjects).toHaveBeenCalledWith({ force: true });
    // The outcome is a standalone clip project (carries project_id), not a game.
    const created = outcome.results.find((r) => r.ok);
    expect(created.project_id).toBe(77);
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
