import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setupPwaUpdatePrompt } from './pwaUpdate';
import { useToastStore } from '../components/shared/Toast';

const { registerSWMock } = vi.hoisted(() => ({ registerSWMock: vi.fn() }));

vi.mock('virtual:pwa-register', () => ({
  registerSW: registerSWMock,
}));

describe('setupPwaUpdatePrompt', () => {
  beforeEach(() => {
    registerSWMock.mockReset();
    useToastStore.setState({ toasts: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows a persistent refresh toast when a new version is waiting', () => {
    const updateSW = vi.fn();
    registerSWMock.mockReturnValue(updateSW);

    setupPwaUpdatePrompt();

    const { onNeedRefresh } = registerSWMock.mock.calls[0][0];
    onNeedRefresh();

    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].title).toBe('New version available');
    // duration 0 = never auto-dismiss; the user must see the prompt
    expect(toasts[0].duration).toBe(0);
    expect(updateSW).not.toHaveBeenCalled();

    toasts[0].action.onClick();
    expect(updateSW).toHaveBeenCalledWith(true);
  });

  it('re-checks for a new service worker hourly for long-lived sessions', () => {
    vi.useFakeTimers();
    registerSWMock.mockReturnValue(vi.fn());

    setupPwaUpdatePrompt();

    const { onRegisteredSW } = registerSWMock.mock.calls[0][0];
    const registration = { update: vi.fn().mockResolvedValue(undefined) };
    onRegisteredSW('/sw.js', registration);

    expect(registration.update).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(registration.update).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(registration.update).toHaveBeenCalledTimes(2);
  });

  it('does not schedule update checks when registration is unavailable', () => {
    vi.useFakeTimers();
    registerSWMock.mockReturnValue(vi.fn());

    setupPwaUpdatePrompt();

    const { onRegisteredSW } = registerSWMock.mock.calls[0][0];
    expect(() => onRegisteredSW('/sw.js', undefined)).not.toThrow();
    expect(vi.getTimerCount()).toBe(0);
  });
});
