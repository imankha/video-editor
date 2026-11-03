import { describe, it, expect, vi, beforeEach } from 'vitest';

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
vi.mock('../utils/captureVideoFrame', () => ({
  captureVideoFrame: vi.fn(() => Promise.resolve(null)),
}));

import { useUploadStore } from './uploadStore';
import { uploadGame } from '../services/uploadManager';

const file = new File([new Uint8Array(4)], 'a.mp4', { type: 'video/mp4' });

describe('T14530: failed upload row copy', () => {
  beforeEach(() => {
    useUploadStore.getState().reset();
    vi.clearAllMocks();
  });

  it('T14530:C5 a pipeline exception never reaches the failed upload row', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    uploadGame.mockRejectedValueOnce(new Error('Part 3 upload failed: 500'));
    useUploadStore.getState().startUpload(file);
    await vi.waitFor(() => {
      expect(useUploadStore.getState().uploads[0]?.status).toBe('error');
    });
    expect(useUploadStore.getState().uploads[0].message).not.toMatch(/Part 3|500/);
    expect(logged.mock.calls.flat().map(String).join(' ')).toContain('Part 3 upload failed: 500');
    logged.mockRestore();
  });
});
