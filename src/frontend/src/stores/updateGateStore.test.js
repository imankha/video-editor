import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useUpdateGateStore } from './updateGateStore';
import { useAuthStore } from './authStore';

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
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    });
    useAuthStore.setState(originalAuthState);
  });

  describe('requireUpdate', () => {
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
