import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useSyncStore, checkSyncStatus } from './syncStore';

describe('syncStore', () => {
  beforeEach(() => {
    useSyncStore.setState({ syncFailed: false, isRetrying: false });
  });

  describe('syncFailed state', () => {
    it('starts as false', () => {
      expect(useSyncStore.getState().syncFailed).toBe(false);
    });

    it('setSyncFailed(true) sets flag', () => {
      useSyncStore.getState().setSyncFailed(true);
      expect(useSyncStore.getState().syncFailed).toBe(true);
    });

    it('setSyncFailed(false) clears flag', () => {
      useSyncStore.getState().setSyncFailed(true);
      useSyncStore.getState().setSyncFailed(false);
      expect(useSyncStore.getState().syncFailed).toBe(false);
    });
  });

  describe('retrySyncToR2', () => {
    it('sets isRetrying during request', async () => {
      // Mock fetch to delay so we can check isRetrying
      const fetchMock = vi.fn(() =>
        Promise.resolve({
          json: () => Promise.resolve({ success: true }),
        })
      );
      vi.stubGlobal('fetch', fetchMock);

      useSyncStore.getState().setSyncFailed(true);

      const promise = useSyncStore.getState().retrySyncToR2();

      // isRetrying should be true while request is in flight
      expect(useSyncStore.getState().isRetrying).toBe(true);

      await promise;

      expect(useSyncStore.getState().isRetrying).toBe(false);
      expect(useSyncStore.getState().syncFailed).toBe(false);

      vi.unstubAllGlobals();
    });

    it('keeps syncFailed on failure', async () => {
      const fetchMock = vi.fn(() =>
        Promise.resolve({
          json: () => Promise.resolve({ success: false }),
        })
      );
      vi.stubGlobal('fetch', fetchMock);

      useSyncStore.getState().setSyncFailed(true);
      const result = await useSyncStore.getState().retrySyncToR2();

      expect(result).toBe(false);
      expect(useSyncStore.getState().syncFailed).toBe(true);

      vi.unstubAllGlobals();
    });

    it('handles network error gracefully', async () => {
      const fetchMock = vi.fn(() => Promise.reject(new Error('Network error')));
      vi.stubGlobal('fetch', fetchMock);

      useSyncStore.getState().setSyncFailed(true);
      const result = await useSyncStore.getState().retrySyncToR2();

      expect(result).toBe(false);
      expect(useSyncStore.getState().isRetrying).toBe(false);

      vi.unstubAllGlobals();
    });
  });
});

describe('checkSyncStatus', () => {
  beforeEach(() => {
    useSyncStore.setState({ syncFailed: false, isRetrying: false });
  });

  it('sets syncFailed when header is "failed"', () => {
    const mockResponse = {
      headers: new Headers({ 'X-Sync-Status': 'failed' }),
    };
    checkSyncStatus(mockResponse);
    expect(useSyncStore.getState().syncFailed).toBe(true);
  });

  it('clears syncFailed when header is absent', () => {
    useSyncStore.getState().setSyncFailed(true);
    const mockResponse = {
      headers: new Headers(),
    };
    checkSyncStatus(mockResponse);
    expect(useSyncStore.getState().syncFailed).toBe(false);
  });

  it('handles null response gracefully', () => {
    checkSyncStatus(null);
    expect(useSyncStore.getState().syncFailed).toBe(false);
  });

  it('handles response without headers gracefully', () => {
    checkSyncStatus({});
    expect(useSyncStore.getState().syncFailed).toBe(false);
  });

  it('does not set if already set (no unnecessary updates)', () => {
    useSyncStore.getState().setSyncFailed(true);
    const setSpy = vi.spyOn(useSyncStore.getState(), 'setSyncFailed');

    const mockResponse = {
      headers: new Headers({ 'X-Sync-Status': 'failed' }),
    };
    checkSyncStatus(mockResponse);

    // Should not call setSyncFailed since it's already true
    expect(setSpy).not.toHaveBeenCalled();
    setSpy.mockRestore();
  });
});
