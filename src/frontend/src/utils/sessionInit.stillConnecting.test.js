import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// T16400: the loading screen never hangs silently. When /api/auth/me gets no answer,
// each attempt gives up after a limit, and after the last one the loading screen says
// "Still connecting" with a Retry button (within 20 s). Retry asks again on the same
// page: no reload.

const setSessionState = vi.fn();
vi.mock('../stores/authStore', () => ({
  useAuthStore: { getState: () => ({ setSessionState, needsTermsAcceptance: false }), setState: vi.fn() },
}));
vi.mock('../stores/editorStore', () => ({
  parseEditorPath: () => ({ profileId: null }),
  useEditorStore: { getState: () => ({ rejectUrlProfile: vi.fn() }) },
}));

const PRELOADER_HTML = `
  <div id="preloader">
    <div id="preloader-progress">
      <div id="preloader-bar"><div id="preloader-bar-fill"></div></div>
      <div id="preloader-status">Connecting to server...</div>
    </div>
  </div>`;

let apiUp = false;

/** A backend that never answers while `apiUp` is false (the request only ends on abort). */
function backend() {
  return vi.fn((input, init = {}) => {
    const url = String(input);
    if (!apiUp) {
      return new Promise((_, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    }
    if (url.includes('/api/auth/me')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ user_id: 'u1' }) });
    if (url.includes('/api/auth/init')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ profile_id: 'p1' }) });
    return Promise.reject(new Error(`unexpected ${url}`));
  });
}

/** Wait (real time) for initSession's dynamic imports to settle and /me to be asked. */
async function untilAsked(fetchMock) {
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled(), { timeout: 10000 });
}

function retryButton() {
  return [...document.querySelectorAll('#preloader button')].find((b) => b.textContent.trim() === 'Retry');
}

describe('sessionInit: API unreachable (T16400)', { timeout: 30000 }, () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    sessionStorage.clear();
    apiUp = false;
    document.body.innerHTML = PRELOADER_HTML;
    window.__preloaderUpdate = (percent, message) => {
      document.getElementById('preloader-status').textContent = message;
    };
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('shows "Still connecting" and a Retry button within 20 seconds', async () => {
    const fetchMock = backend();
    window.fetch = fetchMock;
    const session = await import('./sessionInit');
    session.initSession();
    await untilAsked(fetchMock);

    await vi.advanceTimersByTimeAsync(20000);
    expect(document.getElementById('preloader').textContent).toContain('Still connecting');
    expect(retryButton()).toBeTruthy();
  });

  it('Retry after the API is back opens the app without a reload', async () => {
    const fetchMock = backend();
    window.fetch = fetchMock;
    const session = await import('./sessionInit');
    let result;
    session.initSession().then((r) => { result = r; });
    await untilAsked(fetchMock);
    await vi.advanceTimersByTimeAsync(20000);
    expect(retryButton()).toBeTruthy();
    expect(result).toBeUndefined();

    apiUp = true;
    retryButton().click();
    await vi.waitFor(() => expect(result?.isAuthenticated).toBe(true), { timeout: 10000 });
    await result.profileReady;
    expect(setSessionState).toHaveBeenCalledWith(true, null, null, null, expect.anything());
    expect(retryButton()).toBeFalsy();
    expect(document.getElementById('preloader').textContent).not.toContain('Still connecting');
  });

  it('a 503 from the API (database unreachable) is not read as signed out', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }));
    window.fetch = fetchMock;
    const session = await import('./sessionInit');
    let result;
    session.initSession().then((r) => { result = r; });
    await untilAsked(fetchMock);
    await vi.advanceTimersByTimeAsync(20000);
    expect(result).toBeUndefined();
    expect(setSessionState).not.toHaveBeenCalledWith(false);
    expect(retryButton()).toBeTruthy();
  });
});
