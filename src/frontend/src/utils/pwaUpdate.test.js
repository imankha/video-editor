import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setupPwaUpdatePrompt } from './pwaUpdate';
import { useUpdateGateStore } from '../stores/updateGateStore';

const { registerSWMock } = vi.hoisted(() => ({ registerSWMock: vi.fn() }));

vi.mock('virtual:pwa-register', () => ({
  registerSW: registerSWMock,
}));

const INITIAL_GATE_STATE = {
  isUpdateRequired: false,
  reason: null,
  phase: 'idle',
  error: null,
  _updateSW: null,
};

// Captures the visibilitychange handler instead of registering it on the
// shared jsdom document, so listeners don't leak between tests.
function setup({ waiting = null } = {}) {
  const updateSW = vi.fn();
  registerSWMock.mockReturnValue(updateSW);

  let visibilityHandler = null;
  vi.spyOn(document, 'addEventListener').mockImplementation((type, handler) => {
    if (type === 'visibilitychange') visibilityHandler = handler;
  });

  setupPwaUpdatePrompt();
  const handlers = registerSWMock.mock.calls.at(-1)[0];
  const registration = { waiting, update: vi.fn().mockResolvedValue(undefined) };
  const returnToApp = () => visibilityHandler?.();
  return { updateSW, handlers, registration, returnToApp };
}

describe('setupPwaUpdatePrompt', () => {
  beforeEach(() => {
    registerSWMock.mockReset();
    useUpdateGateStore.setState(INITIAL_GATE_STATE);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ headers: new Headers(), ok: true }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('requires an update (reason: sw) when a new version is waiting', () => {
    const { updateSW, handlers } = setup();

    handlers.onNeedRefresh();

    const state = useUpdateGateStore.getState();
    expect(state.isUpdateRequired).toBe(true);
    expect(state.reason).toBe('sw');
    // The gate itself drives updateSW via runUpdate — onNeedRefresh only raises it.
    expect(updateSW).not.toHaveBeenCalled();
  });

  it('wires updateSW into the store so the gate can trigger skipWaiting + reload', () => {
    const { updateSW } = setup();
    expect(useUpdateGateStore.getState()._updateSW).toBe(updateSW);
  });

  it('is idempotent when onNeedRefresh fires again', () => {
    const { handlers } = setup();
    handlers.onNeedRefresh();
    handlers.onNeedRefresh();
    expect(useUpdateGateStore.getState().reason).toBe('sw');
  });

  it('checks for an update when the app becomes visible again', () => {
    const { handlers, registration, returnToApp } = setup();
    handlers.onRegisteredSW('/sw.js', registration);

    expect(registration.update).not.toHaveBeenCalled();
    returnToApp();
    expect(registration.update).toHaveBeenCalledTimes(1);
  });

  it('rate-limits visibility-triggered checks to one per five minutes', () => {
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(1_000_000);

    const { handlers, registration, returnToApp } = setup();
    handlers.onRegisteredSW('/sw.js', registration);

    returnToApp();
    returnToApp();
    expect(registration.update).toHaveBeenCalledTimes(1);

    now.mockReturnValue(1_000_000 + 5 * 60 * 1000 + 1);
    returnToApp();
    expect(registration.update).toHaveBeenCalledTimes(2);
  });

  it('re-requires the gate on return while an update is still waiting', () => {
    const { handlers, registration, returnToApp } = setup({ waiting: {} });
    handlers.onRegisteredSW('/sw.js', registration);

    handlers.onNeedRefresh();
    expect(useUpdateGateStore.getState().isUpdateRequired).toBe(true);

    // Simulate the store somehow dropping back (defensive — gate has no
    // user-facing dismiss, but the SW-waiting re-check path must still hold).
    useUpdateGateStore.setState({ isUpdateRequired: false, reason: null });

    returnToApp();
    expect(useUpdateGateStore.getState().isUpdateRequired).toBe(true);
    // a waiting SW means there is nothing new to fetch
    expect(registration.update).not.toHaveBeenCalled();
  });

  it('does nothing when registration is unavailable', () => {
    const { handlers, returnToApp } = setup();
    expect(() => handlers.onRegisteredSW('/sw.js', undefined)).not.toThrow();
    expect(() => returnToApp()).not.toThrow();
  });

  it('polls GET /api/version on load', () => {
    setup();
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/version'));
  });

  it('polls GET /api/version again on a throttled visibility return', () => {
    const { handlers, registration, returnToApp } = setup();
    handlers.onRegisteredSW('/sw.js', registration);
    fetch.mockClear();

    returnToApp();
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/version'));
  });
});
