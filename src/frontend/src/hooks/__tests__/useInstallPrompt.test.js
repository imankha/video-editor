import { renderHook, act } from '@testing-library/react';
import { useInstallPrompt } from '../useInstallPrompt';

function mockMatchMedia(standalone) {
  window.matchMedia = vi.fn((query) => ({
    matches: standalone && query === '(display-mode: standalone)',
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

beforeEach(() => {
  sessionStorage.clear();
  mockMatchMedia(false);
  Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 Chrome', configurable: true });
  window.MSStream = undefined;
});

describe('useInstallPrompt', () => {
  it('returns isInstalled true when in standalone mode', () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => useInstallPrompt());
    expect(result.current.isInstalled).toBe(true);
    expect(result.current.canInstall).toBe(false);
  });

  it('returns canInstall true even without beforeinstallprompt', () => {
    const { result } = renderHook(() => useInstallPrompt());
    expect(result.current.canInstall).toBe(true);
    expect(result.current.canPrompt).toBe(false);
  });

  it('returns canPrompt true after beforeinstallprompt fires', () => {
    const { result } = renderHook(() => useInstallPrompt());

    const mockEvent = new Event('beforeinstallprompt');
    mockEvent.prompt = vi.fn();
    mockEvent.userChoice = Promise.resolve({ outcome: 'accepted' });

    act(() => {
      window.dispatchEvent(mockEvent);
    });

    expect(result.current.canInstall).toBe(true);
    expect(result.current.canPrompt).toBe(true);
  });

  it('promptInstall calls event.prompt()', async () => {
    const { result } = renderHook(() => useInstallPrompt());

    const mockEvent = new Event('beforeinstallprompt');
    mockEvent.prompt = vi.fn();
    mockEvent.userChoice = Promise.resolve({ outcome: 'accepted' });

    act(() => {
      window.dispatchEvent(mockEvent);
    });

    await act(async () => {
      await result.current.promptInstall();
    });

    expect(mockEvent.prompt).toHaveBeenCalled();
  });

  it('dismiss hides the prompt for the session', () => {
    const { result } = renderHook(() => useInstallPrompt());

    const mockEvent = new Event('beforeinstallprompt');
    mockEvent.prompt = vi.fn();
    mockEvent.userChoice = Promise.resolve({ outcome: 'dismissed' });

    act(() => {
      window.dispatchEvent(mockEvent);
    });

    expect(result.current.canInstall).toBe(true);

    act(() => {
      result.current.dismiss();
    });

    expect(result.current.canInstall).toBe(false);
    expect(sessionStorage.getItem('pwa-install-dismissed')).toBe('1');
  });

  it('returns isIOS true on iOS user agent', () => {
    Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0)', configurable: true });

    const { result } = renderHook(() => useInstallPrompt());
    expect(result.current.isIOS).toBe(true);
    expect(result.current.canInstall).toBe(true);
  });

  it('sets isInstalled on appinstalled event', () => {
    const { result } = renderHook(() => useInstallPrompt());

    const mockEvent = new Event('beforeinstallprompt');
    mockEvent.prompt = vi.fn();
    mockEvent.userChoice = Promise.resolve({ outcome: 'accepted' });
    act(() => { window.dispatchEvent(mockEvent); });
    expect(result.current.canInstall).toBe(true);

    act(() => { window.dispatchEvent(new Event('appinstalled')); });
    expect(result.current.isInstalled).toBe(true);
    expect(result.current.canInstall).toBe(false);
  });
});
