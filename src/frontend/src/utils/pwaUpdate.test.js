import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setupPwaUpdatePrompt } from './pwaUpdate';
import { useToastStore } from '../components/shared/Toast';

const { registerSWMock } = vi.hoisted(() => ({ registerSWMock: vi.fn() }));

vi.mock('virtual:pwa-register', () => ({
  registerSW: registerSWMock,
}));

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
    useToastStore.setState({ toasts: [] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows a persistent refresh toast when a new version is waiting', () => {
    const { updateSW, handlers } = setup();

    handlers.onNeedRefresh();

    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].title).toBe('New version available');
    // duration 0 = never auto-dismiss; the user must see the prompt
    expect(toasts[0].duration).toBe(0);
    expect(updateSW).not.toHaveBeenCalled();

    toasts[0].action.onClick();
    expect(updateSW).toHaveBeenCalledWith(true);
  });

  it('does not stack duplicate toasts when onNeedRefresh fires again', () => {
    const { handlers } = setup();

    handlers.onNeedRefresh();
    handlers.onNeedRefresh();

    expect(useToastStore.getState().toasts).toHaveLength(1);
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

  it('re-shows a dismissed prompt on return while an update is still waiting', () => {
    const { handlers, registration, returnToApp } = setup({ waiting: {} });
    handlers.onRegisteredSW('/sw.js', registration);

    handlers.onNeedRefresh();
    expect(useToastStore.getState().toasts).toHaveLength(1);

    // user dismisses the toast without refreshing
    useToastStore.setState({ toasts: [] });

    returnToApp();
    expect(useToastStore.getState().toasts).toHaveLength(1);
    // a waiting SW means there is nothing new to fetch
    expect(registration.update).not.toHaveBeenCalled();
  });

  it('does not re-show the prompt on return while it is still visible', () => {
    const { handlers, registration, returnToApp } = setup({ waiting: {} });
    handlers.onRegisteredSW('/sw.js', registration);

    handlers.onNeedRefresh();
    returnToApp();

    expect(useToastStore.getState().toasts).toHaveLength(1);
  });

  it('does nothing when registration is unavailable', () => {
    const { handlers, returnToApp } = setup();
    expect(() => handlers.onRegisteredSW('/sw.js', undefined)).not.toThrow();
    expect(() => returnToApp()).not.toThrow();
  });
});
