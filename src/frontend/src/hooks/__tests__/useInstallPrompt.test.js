import { renderHook, act, waitFor } from '@testing-library/react';
import { useInstallPrompt } from '../useInstallPrompt';

function mockMatchMedia(standalone) {
  window.matchMedia = vi.fn((query) => ({
    matches: standalone && query === '(display-mode: standalone)',
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

function mockInstalledApps(apps = []) {
  navigator.getInstalledRelatedApps = vi.fn(() => Promise.resolve(apps));
}

beforeEach(() => {
  sessionStorage.clear();
  mockMatchMedia(false);
  Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 Chrome', configurable: true });
  window.MSStream = undefined;
  window.__deferredInstallPrompt = null;
  delete navigator.getInstalledRelatedApps;
});

describe('useInstallPrompt', () => {
  it('returns isInstalled true when in standalone mode', () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => useInstallPrompt());
    expect(result.current.isInstalled).toBe(true);
    expect(result.current.canInstall).toBe(false);
  });

  it('returns canInstall false on desktop without beforeinstallprompt', () => {
    const { result } = renderHook(() => useInstallPrompt());
    expect(result.current.canInstall).toBe(false);
    expect(result.current.canPrompt).toBe(false);
    expect(result.current.platform).toBe('desktop');
  });

  it('returns canInstall true on Android without beforeinstallprompt', () => {
    Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (Linux; Android 13) Chrome', configurable: true });
    const { result } = renderHook(() => useInstallPrompt());
    expect(result.current.canInstall).toBe(true);
    expect(result.current.canPrompt).toBe(false);
    expect(result.current.platform).toBe('android');
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

  it('picks up deferred prompt captured before React mounted', () => {
    const mockEvent = { prompt: vi.fn(), userChoice: Promise.resolve({ outcome: 'dismissed' }) };
    window.__deferredInstallPrompt = mockEvent;

    const { result } = renderHook(() => useInstallPrompt());
    expect(result.current.canPrompt).toBe(true);
    expect(result.current.canInstall).toBe(true);
    expect(window.__deferredInstallPrompt).toBeNull();
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

  it('returns platform ios on iOS user agent', () => {
    Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0)', configurable: true });

    const { result } = renderHook(() => useInstallPrompt());
    expect(result.current.platform).toBe('ios');
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

  it('returns installedInBrowser when getInstalledRelatedApps reports installed', async () => {
    mockInstalledApps([{ platform: 'webapp' }]);
    const { result } = renderHook(() => useInstallPrompt());
    await waitFor(() => {
      expect(result.current.installedInBrowser).toBe(true);
    });
    expect(result.current.canInstall).toBe(false);
  });

  it('installedInBrowser is false when getInstalledRelatedApps returns empty', async () => {
    mockInstalledApps([]);
    const { result } = renderHook(() => useInstallPrompt());
    await waitFor(() => {
      expect(navigator.getInstalledRelatedApps).toHaveBeenCalled();
    });
    expect(result.current.installedInBrowser).toBe(false);
  });

  it('installedInBrowser is false when API is not available', () => {
    const { result } = renderHook(() => useInstallPrompt());
    expect(result.current.installedInBrowser).toBe(false);
  });

  it('installedInBrowser is false in standalone mode even if API reports installed', async () => {
    mockInstalledApps([{ platform: 'webapp' }]);
    mockMatchMedia(true);
    const { result } = renderHook(() => useInstallPrompt());
    expect(result.current.installedInBrowser).toBe(false);
    expect(result.current.isInstalled).toBe(true);
  });
});
