import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useUpdateGateStore } from './updateGateStore';

const { flushDurableStateMock } = vi.hoisted(() => ({ flushDurableStateMock: vi.fn() }));

vi.mock('../utils/updateFlush', () => ({
  flushDurableState: flushDurableStateMock,
}));

const INITIAL_STATE = {
  isUpdateRequired: false,
  reason: null,
  phase: 'idle',
  error: null,
  _updateSW: null,
};

describe('updateGateStore', () => {
  let reloadSpy;
  const originalLocation = window.location;

  beforeEach(() => {
    flushDurableStateMock.mockReset();
    useUpdateGateStore.setState(INITIAL_STATE);
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
  });

  describe('requireUpdate', () => {
    it('raises the gate with the given reason', () => {
      useUpdateGateStore.getState().requireUpdate('sw');
      const state = useUpdateGateStore.getState();
      expect(state.isUpdateRequired).toBe(true);
      expect(state.reason).toBe('sw');
    });

    it('is idempotent — a second call does not overwrite the reason', () => {
      useUpdateGateStore.getState().requireUpdate('sw');
      useUpdateGateStore.getState().requireUpdate('version-mismatch');
      expect(useUpdateGateStore.getState().reason).toBe('sw');
    });
  });

  describe('setUpdateSW', () => {
    it('stores the updateSW function for runUpdate to call later', () => {
      const fn = vi.fn();
      useUpdateGateStore.getState().setUpdateSW(fn);
      expect(useUpdateGateStore.getState()._updateSW).toBe(fn);
    });
  });

  describe('runUpdate', () => {
    it('flushes durable state BEFORE calling updateSW/reload (barrier ordering)', async () => {
      const callOrder = [];
      flushDurableStateMock.mockImplementation(async () => {
        callOrder.push('flush');
      });
      const updateSW = vi.fn(async () => {
        callOrder.push('updateSW');
      });
      useUpdateGateStore.getState().setUpdateSW(updateSW);
      reloadSpy.mockImplementation(() => callOrder.push('reload'));

      await useUpdateGateStore.getState().runUpdate();

      expect(callOrder).toEqual(['flush', 'updateSW', 'reload']);
    });

    it('sets phase to flushing while the barrier is in flight', () => {
      let resolveFlush;
      flushDurableStateMock.mockReturnValue(new Promise((r) => { resolveFlush = r; }));

      const pending = useUpdateGateStore.getState().runUpdate();
      expect(useUpdateGateStore.getState().phase).toBe('flushing');

      resolveFlush();
      return pending;
    });

    it('on flush failure: sets phase=error with a message, and NEVER calls updateSW or reloads', async () => {
      flushDurableStateMock.mockRejectedValue(new Error('Could not confirm your latest changes were saved.'));
      const updateSW = vi.fn();
      useUpdateGateStore.getState().setUpdateSW(updateSW);

      await useUpdateGateStore.getState().runUpdate();

      const state = useUpdateGateStore.getState();
      expect(state.phase).toBe('error');
      expect(state.error).toBe('Could not confirm your latest changes were saved.');
      expect(updateSW).not.toHaveBeenCalled();
      expect(reloadSpy).not.toHaveBeenCalled();
    });

    it('reloads even with no waiting SW (the version-mismatch-only case)', async () => {
      flushDurableStateMock.mockResolvedValue(undefined);
      // No setUpdateSW call — _updateSW stays null, as it would for a pure
      // backend-only deploy with no waiting service worker.

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
});
