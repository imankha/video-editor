import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  useUpdateGateStore,
  __resetInputActivityForTest,
  __stopQuiescenceRetryForTest,
} from './updateGateStore';
import { useAuthStore } from './authStore';
import { useExportStore } from './exportStore';
import { useUploadStore } from './uploadStore';
import { checkServerVersion, setBundleProbe, __setClientBuildForTest, __resetProbeStateForTest } from '../utils/appVersion';

const { flushDurableStateMock } = vi.hoisted(() => ({
  flushDurableStateMock: vi.fn(),
}));

vi.mock('../utils/updateFlush', () => ({
  flushDurableState: flushDurableStateMock,
}));

const INITIAL_STATE = {
  isUpdateRequired: false,
  needsMigration: false,
  phase: 'idle',
  error: null,
  _swReloader: null,
};

describe('updateGateStore', () => {
  let reloadSpy;
  const originalLocation = window.location;
  const originalAuthState = useAuthStore.getState();

  beforeEach(() => {
    flushDurableStateMock.mockReset();
    useUpdateGateStore.setState(INITIAL_STATE);
    // Gap A/B (T9310): start every case genuinely input-idle and with no leaked
    // retry timer from a prior non-quiescent case.
    __resetInputActivityForTest();
    __stopQuiescenceRetryForTest();
    useAuthStore.setState({ isAuthenticated: true });
    // jsdom's window.location.reload is non-configurable, so vi.spyOn can't
    // redefine it directly — replace the whole location object instead.
    reloadSpy = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, reload: reloadSpy },
    });
  });

  afterEach(() => {
    __stopQuiescenceRetryForTest();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    });
    useAuthStore.setState(originalAuthState);
    useExportStore.setState({ activeExports: {} });
    useUploadStore.setState({ uploads: [] });
  });

  describe('requireUpdate — flag semantics', () => {
    // T8460: requireUpdate now auto-runs when quiescent (its own describe
    // block below). These cases are about the flag/needsMigration bookkeeping
    // in isolation, so force a non-quiescent environment (an active export)
    // to keep that auto-run from firing and contaminating the assertions.
    beforeEach(() => {
      useExportStore.setState({ activeExports: { 'e-non-quiescent': {} } });
    });

    it('raises the gate (app-code reload by default, no migration)', () => {
      useUpdateGateStore.getState().requireUpdate();
      const state = useUpdateGateStore.getState();
      expect(state.isUpdateRequired).toBe(true);
      expect(state.needsMigration).toBe(false);
    });

    it('is idempotent — a second call does not re-fire or clear state', () => {
      useUpdateGateStore.getState().requireUpdate();
      useUpdateGateStore.getState().requireUpdate();
      expect(useUpdateGateStore.getState().isUpdateRequired).toBe(true);
    });

    it('escalates an app-code gate to a migration gate if a later signal demands it', () => {
      useUpdateGateStore.getState().requireUpdate({ needsMigration: false });
      useUpdateGateStore.getState().requireUpdate({ needsMigration: true });
      expect(useUpdateGateStore.getState().needsMigration).toBe(true);
    });

    it('does not downgrade a migration gate back to app-code-only', () => {
      useUpdateGateStore.getState().requireUpdate({ needsMigration: true });
      useUpdateGateStore.getState().requireUpdate({ needsMigration: false });
      expect(useUpdateGateStore.getState().needsMigration).toBe(true);
    });
  });

  describe('requireUpdate — auto-run (T8460)', () => {
    it('(a) does not auto-run while an export is active — no flush, no reload', () => {
      useExportStore.setState({ activeExports: { 'e1': {} } });

      useUpdateGateStore.getState().requireUpdate();

      expect(useUpdateGateStore.getState().isUpdateRequired).toBe(true);
      expect(useUpdateGateStore.getState().phase).toBe('idle');
      expect(flushDurableStateMock).not.toHaveBeenCalled();
      expect(reloadSpy).not.toHaveBeenCalled();
    });

    it('(b) auto-runs while quiescent: flushes then invokes the reloader', async () => {
      flushDurableStateMock.mockResolvedValue(undefined);
      const reloader = vi.fn().mockResolvedValue(undefined);
      useUpdateGateStore.getState().setSwReloader(reloader);

      useUpdateGateStore.getState().requireUpdate();

      await vi.waitFor(() => expect(reloader).toHaveBeenCalledTimes(1));
      expect(flushDurableStateMock).toHaveBeenCalledTimes(1);
      expect(reloadSpy).not.toHaveBeenCalled();
    });

    it('(c) auto-run flush failure lands the error card state, never reloads', async () => {
      flushDurableStateMock.mockRejectedValue(new Error('Could not save your latest changes.'));
      const reloader = vi.fn();
      useUpdateGateStore.getState().setSwReloader(reloader);

      useUpdateGateStore.getState().requireUpdate();

      await vi.waitFor(() => expect(useUpdateGateStore.getState().phase).toBe('error'));
      expect(useUpdateGateStore.getState().error).toBe('Could not save your latest changes.');
      expect(reloader).not.toHaveBeenCalled();
      expect(reloadSpy).not.toHaveBeenCalled();
    });

    it('(d) a second requireUpdate after conditions clear runs the update', async () => {
      useExportStore.setState({ activeExports: { 'e1': {} } });
      flushDurableStateMock.mockResolvedValue(undefined);
      const reloader = vi.fn().mockResolvedValue(undefined);
      useUpdateGateStore.getState().setSwReloader(reloader);

      useUpdateGateStore.getState().requireUpdate();
      expect(useUpdateGateStore.getState().phase).toBe('idle');
      expect(reloader).not.toHaveBeenCalled();

      useExportStore.setState({ activeExports: {} });
      useUpdateGateStore.getState().requireUpdate();

      await vi.waitFor(() => expect(reloader).toHaveBeenCalledTimes(1));
      expect(flushDurableStateMock).toHaveBeenCalledTimes(1);
    });

    it('(e) real caller path: checkServerVersion (not requireUpdate() called directly) re-tests quiescence on every subsequent response', async () => {
      // requireUpdate() has exactly one production caller: checkServerVersion
      // (appVersion.js). checkServerVersion short-circuits once isUpdateRequired
      // is true, so this proves the RETRY actually happens through that real
      // entry point -- (d) above only proves requireUpdate() itself is correct
      // when called directly, which the real re-check cadence never does on its
      // own unless checkServerVersion re-invokes it.
      __resetProbeStateForTest();
      __setClientBuildForTest(100);
      setBundleProbe(async () => ({ hasBundle: true, stillInstalling: false }));
      useExportStore.setState({ activeExports: { 'e1': {} } });
      flushDurableStateMock.mockResolvedValue(undefined);
      const reloader = vi.fn().mockResolvedValue(undefined);
      useUpdateGateStore.getState().setSwReloader(reloader);

      await checkServerVersion(101);
      expect(useUpdateGateStore.getState().isUpdateRequired).toBe(true);
      expect(useUpdateGateStore.getState().phase).toBe('idle');
      expect(reloader).not.toHaveBeenCalled();

      // The export finishes; the next API response carries the same header.
      useExportStore.setState({ activeExports: {} });
      await checkServerVersion(101);

      await vi.waitFor(() => expect(reloader).toHaveBeenCalledTimes(1));
      expect(flushDurableStateMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('isQuiescent — input-idle (Gap A, T9310)', () => {
    // Gate the auto-run behind a genuine input pause so a reload never lands
    // mid-scrub (playhead/zoom/selection/undo would be lost across it).
    it('is NOT quiescent immediately after a pointer event', () => {
      window.dispatchEvent(new Event('pointerdown'));
      expect(useUpdateGateStore.getState().isQuiescent()).toBe(false);
    });

    it('is NOT quiescent while a scrub drag keeps firing pointermove', () => {
      window.dispatchEvent(new Event('pointermove'));
      expect(useUpdateGateStore.getState().isQuiescent()).toBe(false);
    });

    it('is NOT quiescent immediately after a key event', () => {
      window.dispatchEvent(new Event('keydown'));
      expect(useUpdateGateStore.getState().isQuiescent()).toBe(false);
    });

    it('becomes quiescent again ~5s after the last input', () => {
      const now = vi.spyOn(Date, 'now');
      now.mockReturnValue(1_000_000);
      window.dispatchEvent(new Event('pointerdown')); // lastInputAt = 1_000_000
      expect(useUpdateGateStore.getState().isQuiescent()).toBe(false);

      now.mockReturnValue(1_000_000 + 5_000); // input-idle threshold reached
      expect(useUpdateGateStore.getState().isQuiescent()).toBe(true);
      now.mockRestore();
    });

    it('defers the auto-run while the user is mid-interaction', () => {
      window.dispatchEvent(new Event('pointerdown'));
      const reloader = vi.fn().mockResolvedValue(undefined);
      useUpdateGateStore.getState().setSwReloader(reloader);

      useUpdateGateStore.getState().requireUpdate();

      expect(useUpdateGateStore.getState().isUpdateRequired).toBe(true);
      expect(useUpdateGateStore.getState().phase).toBe('idle');
      expect(reloader).not.toHaveBeenCalled();
      expect(flushDurableStateMock).not.toHaveBeenCalled();
    });
  });

  describe('requireUpdate — quiescence retry poll (Gap B, T9310)', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('resumes on a later tick once the app goes quiescent, with NO new requireUpdate/API call', async () => {
      useExportStore.setState({ activeExports: { e1: {} } });
      flushDurableStateMock.mockResolvedValue(undefined);
      const reloader = vi.fn().mockResolvedValue(undefined);
      useUpdateGateStore.getState().setSwReloader(reloader);

      useUpdateGateStore.getState().requireUpdate(); // deferred: export active
      expect(reloader).not.toHaveBeenCalled();

      // Export finishes silently — nothing calls requireUpdate/checkServerVersion again.
      useExportStore.setState({ activeExports: {} });
      await vi.advanceTimersByTimeAsync(2000);

      expect(reloader).toHaveBeenCalledTimes(1);
      expect(flushDurableStateMock).toHaveBeenCalledTimes(1);
    });

    it('runs immediately (schedules no poll) when the app is already quiescent', async () => {
      flushDurableStateMock.mockResolvedValue(undefined);
      const reloader = vi.fn().mockResolvedValue(undefined);
      useUpdateGateStore.getState().setSwReloader(reloader);

      useUpdateGateStore.getState().requireUpdate();
      await vi.advanceTimersByTimeAsync(0);
      expect(reloader).toHaveBeenCalledTimes(1);
    });

    it('stops polling once the gate clears — no runaway interval', async () => {
      useExportStore.setState({ activeExports: { e1: {} } });
      useUpdateGateStore.getState().requireUpdate(); // schedules the poll

      // The gate clears (e.g. the reload landed): the next tick must stop the poll.
      useUpdateGateStore.setState({ isUpdateRequired: false });
      await vi.advanceTimersByTimeAsync(2000);

      const reloader = vi.fn().mockResolvedValue(undefined);
      useUpdateGateStore.getState().setSwReloader(reloader);
      useExportStore.setState({ activeExports: {} });
      await vi.advanceTimersByTimeAsync(10_000);
      expect(reloader).not.toHaveBeenCalled(); // timer already stopped, not resurrected
    });

    it('does NOT auto-retry a flush failure via the poll (that stays the Retry gesture)', async () => {
      useExportStore.setState({ activeExports: { e1: {} } });
      flushDurableStateMock.mockRejectedValue(new Error('flush failed'));
      useUpdateGateStore.getState().setSwReloader(vi.fn());

      useUpdateGateStore.getState().requireUpdate(); // deferred
      useExportStore.setState({ activeExports: {} });
      await vi.advanceTimersByTimeAsync(2000); // poll -> runUpdate -> flush rejects
      expect(useUpdateGateStore.getState().phase).toBe('error');

      flushDurableStateMock.mockClear();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(flushDurableStateMock).not.toHaveBeenCalled();
    });
  });

  describe('setSwReloader', () => {
    it('stores the SW reloader for runUpdate to await after the flush', () => {
      const fn = vi.fn();
      useUpdateGateStore.getState().setSwReloader(fn);
      expect(useUpdateGateStore.getState()._swReloader).toBe(fn);
    });
  });

  describe('runUpdate — authenticated', () => {
    it('flushes durable state BEFORE invoking the SW reloader (barrier ordering)', async () => {
      const callOrder = [];
      flushDurableStateMock.mockImplementation(async () => { callOrder.push('flush'); });
      const reloader = vi.fn(async () => { callOrder.push('reload'); });
      useUpdateGateStore.getState().setSwReloader(reloader);

      await useUpdateGateStore.getState().runUpdate();

      expect(callOrder).toEqual(['flush', 'reload']);
    });

    it('sets phase to flushing while the barrier is in flight', () => {
      let resolveFlush;
      flushDurableStateMock.mockReturnValue(new Promise((r) => { resolveFlush = r; }));

      const pending = useUpdateGateStore.getState().runUpdate();
      expect(useUpdateGateStore.getState().phase).toBe('flushing');

      resolveFlush();
      return pending;
    });

    it('(e) on flush failure: phase=error with a message, and NEVER invokes the reloader or reloads', async () => {
      flushDurableStateMock.mockRejectedValue(new Error('Could not confirm your latest changes were saved.'));
      const reloader = vi.fn();
      useUpdateGateStore.getState().setSwReloader(reloader);

      await useUpdateGateStore.getState().runUpdate();

      const state = useUpdateGateStore.getState();
      expect(state.phase).toBe('error');
      expect(state.error).toBe('Could not confirm your latest changes were saved.');
      expect(reloader).not.toHaveBeenCalled();
      expect(reloadSpy).not.toHaveBeenCalled();
    });

    it('delegates the reload to the SW reloader (which owns skipWaiting vs bust+reload)', async () => {
      flushDurableStateMock.mockResolvedValue(undefined);
      const reloader = vi.fn().mockResolvedValue(undefined);
      useUpdateGateStore.getState().setSwReloader(reloader);

      await useUpdateGateStore.getState().runUpdate();

      expect(reloader).toHaveBeenCalledTimes(1);
      // The store never forces its own reload — the reloader lands the bundle.
      expect(reloadSpy).not.toHaveBeenCalled();
    });

    it('falls back to a plain reload when no SW reloader is wired', async () => {
      flushDurableStateMock.mockResolvedValue(undefined);
      // _swReloader stays null (setup never ran).

      await useUpdateGateStore.getState().runUpdate();

      expect(reloadSpy).toHaveBeenCalledTimes(1);
    });

    it('does not start a second flush while one is already in flight', async () => {
      let resolveFlush;
      flushDurableStateMock.mockReturnValue(new Promise((r) => { resolveFlush = r; }));

      const first = useUpdateGateStore.getState().runUpdate();
      const second = useUpdateGateStore.getState().runUpdate();

      resolveFlush();
      await Promise.all([first, second]);

      expect(flushDurableStateMock).toHaveBeenCalledTimes(1);
    });

    it('clears a prior error on a retried run that succeeds', async () => {
      flushDurableStateMock.mockRejectedValueOnce(new Error('first failure'));
      await useUpdateGateStore.getState().runUpdate();
      expect(useUpdateGateStore.getState().error).toBe('first failure');

      flushDurableStateMock.mockResolvedValueOnce(undefined);
      await useUpdateGateStore.getState().runUpdate();

      expect(useUpdateGateStore.getState().error).toBeNull();
    });
  });

  describe('runUpdate — unauthenticated (no lockout on the login screen)', () => {
    it('skips the flush barrier entirely and proceeds straight to the reloader', async () => {
      useAuthStore.setState({ isAuthenticated: false });
      const reloader = vi.fn().mockResolvedValue(undefined);
      useUpdateGateStore.getState().setSwReloader(reloader);

      await useUpdateGateStore.getState().runUpdate();

      expect(flushDurableStateMock).not.toHaveBeenCalled();
      expect(reloader).toHaveBeenCalledTimes(1);
      expect(useUpdateGateStore.getState().phase).not.toBe('error');
    });
  });
});
