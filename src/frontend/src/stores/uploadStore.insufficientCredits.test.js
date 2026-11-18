/**
 * T17380: an upload that fails for lack of credits must not leave a stuck game.
 *
 * uploadGame creates the pending game before the credit check, and T8180 keeps that
 * game when the user is annotating it. The store used to retire the entry on
 * insufficient credits, so Home showed nothing for a game that never finished. The
 * entry now stays as a failed upload that names credits and can be retried.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../services/uploadManager', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, uploadGame: vi.fn(), uploadMultiVideoGame: vi.fn() };
});
vi.mock('../components/shared', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock('./creditStore', () => ({
  useCreditStore: { getState: () => ({ fetchCredits: vi.fn() }) },
}));
vi.mock('../utils/captureVideoFrame', () => ({
  captureVideoFrame: vi.fn(() => Promise.resolve(null)),
}));

import { useUploadStore, UPLOAD_STATUS } from './uploadStore';
import { uploadGame } from '../services/uploadManager';
import { toast } from '../components/shared';

const store = () => useUploadStore.getState();
const file = new File([new Uint8Array(4)], 'game.mp4', { type: 'video/mp4' });

function creditsError() {
  const err = new Error('Insufficient credits: need 2, have 1');
  err.insufficientCredits = true;
  err.uploadCost = 2;
  err.balance = 1;
  return err;
}

describe('T17380: insufficient-credits upload failure', () => {
  beforeEach(() => {
    store().reset();
    vi.clearAllMocks();
  });

  it('T17380:C1 keeps the upload as a failed entry that explains credits, and opens the credits modal', async () => {
    uploadGame.mockImplementationOnce(async (f, p, opts) => {
      opts.onGameCreated({ game_id: 7, name: 'Game' });
      throw creditsError();
    });
    store().startUpload(file, { opponentName: 'Rivals' });

    await vi.waitFor(() => expect(store().insufficientCredits).not.toBeNull());
    expect(store().insufficientCredits).toEqual({ required: 2, balance: 1 });
    expect(store().uploads).toHaveLength(1);
    const entry = store().uploads[0];
    expect(entry.status).toBe(UPLOAD_STATUS.ERROR);
    expect(entry.gameId).toBe(7);
    expect(entry.insufficientCredits).toBe(true);
    expect(entry.message).toMatch(/credits/i);
    expect(entry.message).toMatch(/retry/i);
    expect(entry.message).not.toMatch(/need 2, have 1/);
    // The credits modal is the loud surface; no second "Upload failed" toast.
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('T17380:C2 retrying after buying credits completes the upload', async () => {
    uploadGame.mockRejectedValueOnce(creditsError());
    store().startUpload(file, { opponentName: 'Rivals' });
    await vi.waitFor(() => expect(store().uploads[0]?.status).toBe(UPLOAD_STATUS.ERROR));

    uploadGame.mockResolvedValueOnce({ game_id: 7, name: 'Game', status: 'ready' });
    store().retryUpload(store().uploads[0].id);

    await vi.waitFor(() => expect(store().uploads).toHaveLength(0));
    expect(uploadGame).toHaveBeenCalledTimes(2);
    expect(uploadGame.mock.calls[1][0]).toBe(file);
    expect(toast.success).toHaveBeenCalledWith('Game ready!', expect.anything());
  });
});
