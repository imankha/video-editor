/**
 * bug26p: a failed upload must NEVER look like success.
 *
 * The reported bug ("added a game but it never showed up") was caused by
 * onUploadError setting an error phase on the small corner indicator but never
 * surfacing a prominent error. These tests pin the contract:
 *   - a real failure fires toast.error AND retains a one-click Retry context
 *   - a successful upload still fires toast.success
 *   - the insufficient-credits path uses the modal (no toast, no retry)
 *   - Retry re-runs the exact same upload
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the upload orchestration so we control success/failure, but keep the real
// UPLOAD_PHASE constants.
vi.mock('../services/uploadManager', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, uploadGame: vi.fn(), uploadMultiVideoGame: vi.fn() };
});
vi.mock('../components/shared', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock('./questStore', () => ({
  useQuestStore: { getState: () => ({ fetchProgress: vi.fn() }) },
}));
vi.mock('./creditStore', () => ({
  useCreditStore: { getState: () => ({ fetchCredits: vi.fn() }) },
}));

import { useUploadStore } from './uploadStore';
import { uploadGame, UPLOAD_PHASE } from '../services/uploadManager';
import { toast } from '../components/shared';

const file = () => new File(['x'], 'game.mp4', { type: 'video/mp4' });
const start = () =>
  useUploadStore.getState().startUpload(
    file(),
    { opponentName: 'Rivals' },
    { duration: 1, width: 2, height: 2 },
    null,
    { gameName: 'My Game' },
    null,
  );

describe('uploadStore — failure surfacing (bug26p)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useUploadStore.getState().reset();
  });

  it('fires toast.error and retains a Retry context on failure', async () => {
    uploadGame.mockRejectedValueOnce(new Error('R2 exploded'));

    start();

    await vi.waitFor(() =>
      expect(useUploadStore.getState().activeUpload?.phase).toBe(UPLOAD_PHASE.ERROR),
    );
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error.mock.calls[0][0]).toMatch(/upload failed/i);
    // Retry context retained (holds the File handle) so Retry can re-run it.
    expect(useUploadStore.getState().retryContext).not.toBeNull();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('still fires toast.success on a successful upload', async () => {
    uploadGame.mockResolvedValueOnce({ game_id: 7, name: 'My Game', status: 'created' });

    start();

    await vi.waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    // Success clears the active upload and the retry context.
    expect(useUploadStore.getState().activeUpload).toBeNull();
    expect(useUploadStore.getState().retryContext).toBeNull();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('uses the credits modal (no toast, no retry) on insufficient credits', async () => {
    const err = new Error('Insufficient credits');
    err.insufficientCredits = true;
    err.uploadCost = 5;
    err.balance = 2;
    uploadGame.mockRejectedValueOnce(err);

    start();

    await vi.waitFor(() =>
      expect(useUploadStore.getState().insufficientCredits).not.toBeNull(),
    );
    expect(useUploadStore.getState().insufficientCredits).toEqual({ required: 5, balance: 2 });
    expect(toast.error).not.toHaveBeenCalled();
    expect(useUploadStore.getState().retryContext).toBeNull();
  });

  it('retryUpload re-runs the same upload', async () => {
    uploadGame.mockRejectedValueOnce(new Error('transient'));

    start();
    await vi.waitFor(() =>
      expect(useUploadStore.getState().activeUpload?.phase).toBe(UPLOAD_PHASE.ERROR),
    );

    uploadGame.mockResolvedValueOnce({ game_id: 8, name: 'My Game', status: 'created' });
    useUploadStore.getState().retryUpload();

    await vi.waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    expect(uploadGame).toHaveBeenCalledTimes(2); // original + retry
  });
});

// T4100 fix 3: the honest message the manager emits (e.g. dedup's "Already
// uploaded - finishing up") must reach activeUpload.message. The store used to
// hardcode 'Uploading...' and discard every manager message, so the user-visible
// indicator could never show it. These pin the passthrough (the store half of
// the chain proven end-to-end by UploadProgressIndicator.test.jsx).
describe('uploadStore — honest progress message passthrough (T4100)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useUploadStore.getState().reset();
  });

  it('forwards the manager message into activeUpload.message', async () => {
    // Drive the progressHandler like the real dedup path does, then stay pending
    // so we can inspect the store mid-flight (before completion nulls it).
    uploadGame.mockImplementationOnce((_file, onProgress) => {
      onProgress({ phase: UPLOAD_PHASE.FINALIZING, percent: 100, message: 'Already uploaded - finishing up' });
      return new Promise(() => {}); // never resolves
    });

    start();

    await vi.waitFor(() =>
      expect(useUploadStore.getState().activeUpload?.message).toBe('Already uploaded - finishing up'),
    );
    // Explicitly NOT the old hardcoded placeholder.
    expect(useUploadStore.getState().activeUpload?.message).not.toBe('Uploading...');
  });

  it('falls back to "Uploading..." only when the manager omits a message', async () => {
    uploadGame.mockImplementationOnce((_file, onProgress) => {
      onProgress({ phase: UPLOAD_PHASE.UPLOADING, percent: 20 }); // no message field
      return new Promise(() => {});
    });

    start();

    await vi.waitFor(() =>
      expect(useUploadStore.getState().activeUpload?.phase).toBe(UPLOAD_PHASE.UPLOADING),
    );
    expect(useUploadStore.getState().activeUpload?.message).toBe('Uploading...');
  });
});
