import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  useSyncStore,
  checkSyncStatus,
  surfaceRestoredNoticeIfPending,
  isMutatingApiRequest,
} from './syncStore';
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

// T5960: "has THIS session attempted a write?" is armed by the fetch
// interceptor on a mutating request to our own API. Only that arms the conflict
// alarm; a passive (read-only) session stays silent.
describe('write-attempt arming (T5960)', () => {
  beforeEach(() => {
    useSyncStore.setState({ hasAttemptedWrite: false });
  });

  it('starts with hasAttemptedWrite false', () => {
    expect(useSyncStore.getState().hasAttemptedWrite).toBe(false);
  });

  it('markWriteAttempted flips it true', () => {
    useSyncStore.getState().markWriteAttempted();
    expect(useSyncStore.getState().hasAttemptedWrite).toBe(true);
  });

  describe('isMutatingApiRequest', () => {
    it('arms on POST/PUT/PATCH/DELETE to our own API', () => {
      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
        expect(isMutatingApiRequest('/api/clips/raw/save', { method })).toBe(true);
      }
    });

    it('does NOT arm on a GET (default method)', () => {
      expect(isMutatingApiRequest('/api/games', {})).toBe(false);
      expect(isMutatingApiRequest('/api/games', undefined)).toBe(false);
    });

    it('handles a lowercase method', () => {
      expect(isMutatingApiRequest('/api/clips/raw/save', { method: 'post' })).toBe(true);
    });

    it('reads the method + url from a Request object in args[0]', () => {
      // Same-origin absolute URL, matching how the app issues API calls.
      const base = window.location.origin;
      const req = new Request(`${base}/api/clips/raw/save`, { method: 'POST' });
      expect(isMutatingApiRequest(req, undefined)).toBe(true);
      const getReq = new Request(`${base}/api/games`, { method: 'GET' });
      expect(isMutatingApiRequest(getReq, undefined)).toBe(false);
    });

    it('does NOT arm on a mutating request to a foreign origin (R2 presigned PUT)', () => {
      expect(
        isMutatingApiRequest('https://bucket.r2.cloudflarestorage.com/x?sig=1', {
          method: 'PUT',
        })
      ).toBe(false);
    });

    it('does NOT arm on a non-/api same-origin request', () => {
      expect(isMutatingApiRequest('/storage/warmup', { method: 'POST' })).toBe(false);
    });

    it('does NOT arm on session/telemetry lifecycle writes marked rbLifecycleWrite (T6020)', () => {
      // POST /api/auth/init fires on EVERY app load — the real defeat of the
      // naive "any write" rule. These are not user edits and must stay silent.
      // T6020: classification is now by the call-site marker, not the URL.
      expect(isMutatingApiRequest('/api/auth/init', { method: 'POST', rbLifecycleWrite: true })).toBe(false);
      expect(isMutatingApiRequest('/api/auth/heartbeat', { method: 'POST', rbLifecycleWrite: true })).toBe(false);
      expect(isMutatingApiRequest('/api/auth/session-close', { method: 'POST', rbLifecycleWrite: true })).toBe(false);
      expect(isMutatingApiRequest('/api/auth/accept-terms', { method: 'POST', rbLifecycleWrite: true })).toBe(false);
      expect(isMutatingApiRequest('/api/client-errors/video', { method: 'POST', rbLifecycleWrite: true })).toBe(false);
    });

    it('does NOT arm on export-recovery mount-time reconciliation, marked (T6020)', () => {
      // useExportRecovery.js fires these on MOUNT whenever a prior export finished
      // or is still running while the user was away — zero user intent, common
      // for any user who recently exported. Both would re-break acceptance
      // criterion 1 (silent passive load) if left unmarked.
      expect(isMutatingApiRequest('/api/exports/acknowledge', { method: 'POST', rbLifecycleWrite: true })).toBe(false);
      expect(isMutatingApiRequest('/api/exports/123/resume-progress', { method: 'POST', rbLifecycleWrite: true })).toBe(false);
      expect(isMutatingApiRequest('/api/exports/job-abc-9/resume-progress', { method: 'POST', rbLifecycleWrite: true })).toBe(false);
    });

    it('DOES arm on a real export-start gesture (unmarked -- does not over-exclude /api/exports/)', () => {
      // These are real gesture writes (the export button) -- unmarked, must arm.
      expect(isMutatingApiRequest('/api/exports', { method: 'POST' })).toBe(true);
      expect(isMutatingApiRequest('/api/exports/framing', { method: 'POST' })).toBe(true);
    });

    it('DOES arm on genuine user-data write gestures', () => {
      expect(isMutatingApiRequest('/api/settings', { method: 'PUT' })).toBe(true);
      expect(isMutatingApiRequest('/api/clips/raw/save', { method: 'POST' })).toBe(true);
      expect(isMutatingApiRequest('/api/projects/1/actions', { method: 'POST' })).toBe(true);
    });

    // T6020: PATCH /api/projects/{id}/state is hit both by project-OPEN
    // bookkeeping (useProjectLoader.js, marked lifecycle) and by a real
    // mode-switch GESTURE (App.jsx, unmarked) at the IDENTICAL pathname. A
    // URL-only matcher structurally cannot tell these apart -- this is the
    // exact case the call-site marker mechanism exists to solve.
    it('project-open PATCH (marked) does NOT arm; mode-switch PATCH (unmarked) to the SAME pathname DOES', () => {
      const pathname = '/api/projects/42/state';
      // RED without the T6020 fix: the old URL denylist could not distinguish
      // these two calls to the identical path, so project-open incorrectly armed.
      expect(
        isMutatingApiRequest(`${pathname}?update_last_opened=true&current_mode=framing`, {
          method: 'PATCH',
          rbLifecycleWrite: true,
        })
      ).toBe(false);
      expect(
        isMutatingApiRequest(`${pathname}?current_mode=overlay`, { method: 'PATCH' })
      ).toBe(true);
    });
  });

  it('the fetch interceptor arms the store on a mutating API request only', async () => {
    vi.resetModules();
    const stub = vi.fn(async () => ({ headers: new Headers() }));
    vi.stubGlobal('fetch', stub);
    // Fresh import so the interceptor wraps the stubbed fetch.
    const store = await import('./syncStore');
    store.useSyncStore.setState({ hasAttemptedWrite: false });

    // A GET must NOT arm it.
    await window.fetch('/api/games');
    expect(store.useSyncStore.getState().hasAttemptedWrite).toBe(false);

    // A POST to our API arms it.
    await window.fetch('/api/clips/raw/save', { method: 'POST' });
    expect(store.useSyncStore.getState().hasAttemptedWrite).toBe(true);

    vi.unstubAllGlobals();
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
