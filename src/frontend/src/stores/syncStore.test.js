import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useSyncStore, checkSyncStatus, surfaceRestoredNoticeIfPending } from './syncStore';
import { useToastStore } from '../components/shared/Toast';

const RESTORED_KEY = 't5870_restored_notice';

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

// BLOCKING (round 2): a conflict Retry that RESTORES R2's copy discarded the
// user's local edit. The client must TELL the user and RELOAD — never silently
// flip to 'ok'.
describe('conflict-restore notice (T5870 round 2 BLOCKING)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    useToastStore.setState({ toasts: [] });
  });

  it('surfaceRestoredNoticeIfPending fires a persistent notice and consumes the flag', () => {
    sessionStorage.setItem(RESTORED_KEY, '1');
    const shown = surfaceRestoredNoticeIfPending();
    expect(shown).toBe(true);
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].title).toMatch(/replaced/i);
    expect(toasts[0].duration).toBe(0); // persistent
    expect(sessionStorage.getItem(RESTORED_KEY)).toBeNull(); // consumed
  });

  it('does nothing when no restore is pending', () => {
    expect(surfaceRestoredNoticeIfPending()).toBe(false);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('retrySyncToR2 on {restored:true} reloads + stashes notice, never flips to ok', async () => {
    vi.resetModules();
    sessionStorage.clear();
    const reload = vi.fn();
    const originalLocation = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true, writable: true,
      value: { ...originalLocation, reload },
    });
    vi.stubGlobal('fetch', vi.fn(async () => ({
      json: async () => ({ success: true, restored: true }),
    })));
    // Fresh import so the module's captured _originalFetch is the mock.
    const store = await import('./syncStore');
    store.useSyncStore.setState({ syncState: 'conflict', isRetrying: false });

    const ok = await store.useSyncStore.getState().retrySyncToR2();

    // RED without fix: the old branch set syncState 'ok' and never reloaded.
    expect(ok).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(RESTORED_KEY)).toBe('1');
    expect(store.useSyncStore.getState().syncState).toBe('conflict'); // NOT 'ok'
    vi.unstubAllGlobals();
    Object.defineProperty(window, 'location', {
      configurable: true, writable: true, value: originalLocation,
    });
  });
});
