import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setupPwaUpdatePrompt, evictStaleDevServiceWorker } from './pwaUpdate';
import { useUpdateGateStore } from '../stores/updateGateStore';

const { registerSWMock } = vi.hoisted(() => ({ registerSWMock: vi.fn() }));

vi.mock('virtual:pwa-register', () => ({
  registerSW: registerSWMock,
}));

const INITIAL_GATE_STATE = {
  isUpdateRequired: false,
  needsMigration: false,
  phase: 'idle',
  error: null,
  _swReloader: null,
};

const flushMicrotasks = () => new Promise((r) => setTimeout(r, 0));

// Captures the visibility/pageshow handlers instead of registering them on the
// shared jsdom document/window, and mocks navigator.serviceWorker so the
// reloader's controllerchange wait can be driven deterministically.
function setup({ waiting = null } = {}) {
  const updateSW = vi.fn().mockResolvedValue(undefined);
  registerSWMock.mockReturnValue(updateSW);

  let visibilityHandler = null;
  vi.spyOn(document, 'addEventListener').mockImplementation((type, handler) => {
    if (type === 'visibilitychange') visibilityHandler = handler;
  });
  let pageshowHandler = null;
  vi.spyOn(window, 'addEventListener').mockImplementation((type, handler) => {
    if (type === 'pageshow') pageshowHandler = handler;
  });

  let controllerChangeHandler = null;
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      addEventListener: vi.fn((type, h) => {
        if (type === 'controllerchange') controllerChangeHandler = h;
      }),
      removeEventListener: vi.fn(),
    },
  });

  setupPwaUpdatePrompt();
  const handlers = registerSWMock.mock.calls.at(-1)[0];
  const registration = {
    waiting,
    update: vi.fn().mockResolvedValue(undefined),
    unregister: vi.fn().mockResolvedValue(undefined),
  };
  return {
    updateSW,
    handlers,
    registration,
    returnToApp: () => visibilityHandler?.(),
    pageshow: (persisted) => pageshowHandler?.({ persisted }),
    fireControllerChange: () => controllerChangeHandler?.(),
  };
}

describe('setupPwaUpdatePrompt', () => {
  let reloadSpy;
  const originalLocation = window.location;

  beforeEach(() => {
    registerSWMock.mockReset();
    useUpdateGateStore.setState(INITIAL_GATE_STATE);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ headers: new Headers(), ok: true }));
    reloadSpy = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, reload: reloadSpy },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
    delete navigator.serviceWorker;
  });

  describe('gating is truth-based, not SW-based (Tbug40p / bug40)', () => {
    it('(d) onNeedRefresh is a no-op — a waiting SW alone NEVER raises the gate', () => {
      const { handlers } = setup();
      handlers.onNeedRefresh();
      expect(useUpdateGateStore.getState().isUpdateRequired).toBe(false);
    });

    it('(a/d) a visibility return with a waiting SW does NOT gate (kills the every-resume re-nag)', () => {
      const { handlers, registration, returnToApp } = setup({ waiting: {} });
      handlers.onRegisteredSW('/sw.js', registration);
      returnToApp();
      expect(useUpdateGateStore.getState().isUpdateRequired).toBe(false);
    });

    it('(a/d) a bfcache restore with a waiting SW does NOT gate', () => {
      const { handlers, registration, pageshow } = setup({ waiting: {} });
      handlers.onRegisteredSW('/sw.js', registration);
      pageshow(true);
      expect(useUpdateGateStore.getState().isUpdateRequired).toBe(false);
    });
  });

  describe('resume behavior: SW is the mechanism, the poll is the trigger', () => {
    it('wires an SW reloader into the store for the gate to await on update', () => {
      setup();
      expect(typeof useUpdateGateStore.getState()._swReloader).toBe('function');
    });

    it('lets the SW discover a new bundle on visibility return (mechanism, not gate)', () => {
      const { handlers, registration, returnToApp } = setup();
      handlers.onRegisteredSW('/sw.js', registration);
      expect(registration.update).not.toHaveBeenCalled();
      returnToApp();
      expect(registration.update).toHaveBeenCalledTimes(1);
    });

    it('polls GET /api/version on load (establishes the server build number)', () => {
      setup();
      expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/version'));
    });

    it('rate-limits the resume poll to one per five minutes', () => {
      const now = vi.spyOn(Date, 'now');
      now.mockReturnValue(1_000_000);
      const { handlers, registration, returnToApp } = setup();
      handlers.onRegisteredSW('/sw.js', registration);
      fetch.mockClear();

      returnToApp();
      returnToApp();
      expect(fetch).toHaveBeenCalledTimes(1);

      now.mockReturnValue(1_000_000 + 5 * 60 * 1000 + 1);
      returnToApp();
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('polls on a bfcache restore (persisted) but ignores a non-persisted pageshow', () => {
      const { handlers, registration, pageshow } = setup();
      handlers.onRegisteredSW('/sw.js', registration);
      fetch.mockClear();

      pageshow(false);
      expect(fetch).not.toHaveBeenCalled();

      pageshow(true);
      expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/version'));
    });

    it('polls even when onRegisteredSW never fires (dev server / failed registration)', () => {
      const { returnToApp } = setup();
      fetch.mockClear();
      returnToApp();
      expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/version'));
    });

    it('does not throw on resume when no registration was ever provided', () => {
      const { returnToApp } = setup();
      expect(() => returnToApp()).not.toThrow();
    });
  });

  describe('SW reloader — Objective 2: actually land the latest bundle', () => {
    it('activates a waiting SW via updateSW(true); does not force a reload when controllerchange fires', async () => {
      const { handlers, registration, updateSW, fireControllerChange } = setup({ waiting: {} });
      handlers.onRegisteredSW('/sw.js', registration);
      const reloader = useUpdateGateStore.getState()._swReloader;

      const pending = reloader();
      await flushMicrotasks(); // registration.update() resolves + waitForControllerChange registers
      fireControllerChange(); // workbox-window will reload the page itself
      await pending;

      expect(updateSW).toHaveBeenCalledWith(true);
      expect(registration.unregister).not.toHaveBeenCalled();
      expect(reloadSpy).not.toHaveBeenCalled();
    });

    it('(f) busts a stale SW (unregister) and reloads when skipWaiting activation times out (Safari quirk)', async () => {
      vi.useFakeTimers();
      const { handlers, registration, updateSW } = setup({ waiting: {} });
      handlers.onRegisteredSW('/sw.js', registration);
      const reloader = useUpdateGateStore.getState()._swReloader;

      const pending = reloader();
      // controllerchange never fires; advance past the activation timeout.
      await vi.advanceTimersByTimeAsync(4000);
      await pending;

      expect(updateSW).toHaveBeenCalledWith(true);
      expect(registration.unregister).toHaveBeenCalledTimes(1);
      expect(reloadSpy).toHaveBeenCalledTimes(1);
      vi.useRealTimers();
    });

    it('with no waiting SW, busts + reloads directly (backend-only bump / no staged bundle)', async () => {
      const { handlers, registration, updateSW } = setup({ waiting: null });
      handlers.onRegisteredSW('/sw.js', registration);
      const reloader = useUpdateGateStore.getState()._swReloader;

      await reloader();

      expect(updateSW).not.toHaveBeenCalled();
      expect(registration.unregister).toHaveBeenCalledTimes(1);
      expect(reloadSpy).toHaveBeenCalledTimes(1);
    });
  });
});

describe('evictStaleDevServiceWorker (T6630 round 4)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('unregisters every existing service worker registration', async () => {
    const reg1 = { unregister: vi.fn().mockResolvedValue(true) };
    const reg2 = { unregister: vi.fn().mockResolvedValue(true) };
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { getRegistrations: vi.fn().mockResolvedValue([reg1, reg2]) },
    });

    await evictStaleDevServiceWorker();

    expect(reg1.unregister).toHaveBeenCalledTimes(1);
    expect(reg2.unregister).toHaveBeenCalledTimes(1);
  });

  it('clears every cache (a stale SW\'s precache can outlive the SW itself)', async () => {
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { getRegistrations: vi.fn().mockResolvedValue([]) },
    });
    const deleteMock = vi.fn().mockResolvedValue(true);
    global.caches = { keys: vi.fn().mockResolvedValue(['workbox-precache-v1', 'other-cache']), delete: deleteMock };

    await evictStaleDevServiceWorker();

    expect(deleteMock).toHaveBeenCalledWith('workbox-precache-v1');
    expect(deleteMock).toHaveBeenCalledWith('other-cache');
  });

  it('is a no-op (never throws) when serviceWorker is unsupported', async () => {
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: undefined });
    await expect(evictStaleDevServiceWorker()).resolves.not.toThrow();
  });

  it('never throws even if getRegistrations itself rejects', async () => {
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { getRegistrations: vi.fn().mockRejectedValue(new Error('boom')) },
    });
    await expect(evictStaleDevServiceWorker()).resolves.not.toThrow();
  });
});
