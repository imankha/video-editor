import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useSyncStore, checkSyncStatus } from './syncStore';

describe('syncStore', () => {
  beforeEach(() => {
    useSyncStore.setState({ syncState: 'ok', isRetrying: false });
  });

  describe('syncState', () => {
    it('starts as "ok"', () => {
      expect(useSyncStore.getState().syncState).toBe('ok');
    });

    it('setSyncState updates the state', () => {
      useSyncStore.getState().setSyncState('failed');
      expect(useSyncStore.getState().syncState).toBe('failed');
      useSyncStore.getState().setSyncState('ok');
      expect(useSyncStore.getState().syncState).toBe('ok');
    });
  });

  describe('retrySyncToR2', () => {
    it('never throws and always returns a boolean', async () => {
      useSyncStore.getState().setSyncState('failed');
      const result = await useSyncStore.getState().retrySyncToR2();
      expect(typeof result).toBe('boolean');
      expect(useSyncStore.getState().isRetrying).toBe(false);
    });
  });
});

describe('checkSyncStatus (T5870 three-state)', () => {
  beforeEach(() => {
    useSyncStore.setState({ syncState: 'ok', isRetrying: false });
  });

  it('maps "pending" to a quiet pending state (NOT failed)', () => {
    checkSyncStatus({ headers: new Headers({ 'X-Sync-Status': 'pending' }) });
    // RED without fix: the old store only knew a syncFailed boolean and mapped
    // any non-ok header to "failed", alarming on a mere defer.
    expect(useSyncStore.getState().syncState).toBe('pending');
  });

  it('maps "failed" to the alarm state', () => {
    checkSyncStatus({ headers: new Headers({ 'X-Sync-Status': 'failed' }) });
    expect(useSyncStore.getState().syncState).toBe('failed');
  });

  it('maps "conflict" to the alarm state', () => {
    checkSyncStatus({ headers: new Headers({ 'X-Sync-Status': 'conflict' }) });
    expect(useSyncStore.getState().syncState).toBe('conflict');
  });

  it('clears to "ok" when the header is absent', () => {
    useSyncStore.getState().setSyncState('failed');
    checkSyncStatus({ headers: new Headers() });
    expect(useSyncStore.getState().syncState).toBe('ok');
  });

  it('handles null response gracefully', () => {
    checkSyncStatus(null);
    expect(useSyncStore.getState().syncState).toBe('ok');
  });

  it('does not re-set when the state is unchanged', () => {
    useSyncStore.getState().setSyncState('failed');
    const setSpy = vi.spyOn(useSyncStore.getState(), 'setSyncState');
    checkSyncStatus({ headers: new Headers({ 'X-Sync-Status': 'failed' }) });
    expect(setSpy).not.toHaveBeenCalled();
    setSpy.mockRestore();
  });
});
