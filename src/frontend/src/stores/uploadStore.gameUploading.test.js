import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useUploadStore, useIsGameUploading, UPLOAD_STATUS } from './uploadStore';

// A game's source isn't in storage until ITS upload finishes, so highlight
// entry points for that game stay locked while any entry for it is unfinished
// (uploading, queued, or errored awaiting Retry). Other games are unaffected.
describe('useIsGameUploading', () => {
  beforeEach(() => useUploadStore.setState({ uploads: [] }));

  const entry = (gameId, status) => ({ id: `u${gameId}${status}`, gameId, status });

  it('is true while this game has an unfinished upload entry', () => {
    for (const status of [UPLOAD_STATUS.UPLOADING, UPLOAD_STATUS.QUEUED, UPLOAD_STATUS.ERROR]) {
      useUploadStore.setState({ uploads: [entry(7, status)] });
      const { result } = renderHook(() => useIsGameUploading(7));
      expect(result.current, status).toBe(true);
    }
  });

  it('is false for another game, no game id, or once the entry retires', () => {
    useUploadStore.setState({ uploads: [entry(7, UPLOAD_STATUS.UPLOADING)] });
    expect(renderHook(() => useIsGameUploading(8)).result.current).toBe(false);
    expect(renderHook(() => useIsGameUploading(null)).result.current).toBe(false);

    const { result } = renderHook(() => useIsGameUploading(7));
    expect(result.current).toBe(true);
    act(() => useUploadStore.setState({ uploads: [] }));
    expect(result.current).toBe(false);
  });
});
