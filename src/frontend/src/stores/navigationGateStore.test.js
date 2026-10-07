import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useNavigationGateStore, NAVIGATION_GATE_TIMEOUT_MS } from './navigationGateStore';

describe('navigationGateStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useNavigationGateStore.setState({ pending: 0 });
  });
  afterEach(() => vi.useRealTimers());

  it('holds the gate until the tracked writes settle', async () => {
    let resolve;
    const writes = new Promise((r) => { resolve = r; });
    useNavigationGateStore.getState().track(writes);
    expect(useNavigationGateStore.getState().pending).toBe(1);
    resolve();
    await writes;
    await Promise.resolve();
    expect(useNavigationGateStore.getState().pending).toBe(0);
  });

  it('releases on rejection too', async () => {
    const writes = Promise.reject(new Error('boom'));
    writes.catch(() => {});
    useNavigationGateStore.getState().track(writes).catch(() => {});
    await new Promise((r) => r());
    await Promise.resolve();
    expect(useNavigationGateStore.getState().pending).toBe(0);
  });

  it('a hung write cannot lock the UI: the backstop timeout releases it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    useNavigationGateStore.getState().track(new Promise(() => {}));
    expect(useNavigationGateStore.getState().pending).toBe(1);
    vi.advanceTimersByTime(NAVIGATION_GATE_TIMEOUT_MS + 1);
    expect(useNavigationGateStore.getState().pending).toBe(0);
    expect(warn).toHaveBeenCalled();
  });
});
