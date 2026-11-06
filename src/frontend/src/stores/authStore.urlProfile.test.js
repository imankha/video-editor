import { describe, it, expect, beforeEach, vi } from 'vitest';

// T14970: a first sign-in does not reload, so the startup check that sets an editor URL's
// profile has not run. It must run here, before the session opens, or the object opens in the
// account's active profile. It cannot be a reload: pendingAction is a closure and would be lost.

vi.mock('../config', () => ({ API_BASE: '' }));
const applyUrlProfile = vi.fn(async () => {});
vi.mock('../utils/sessionInit', () => ({
  getUserId: () => null,
  setUserId: vi.fn(),
  resetSession: vi.fn(),
  clearProfileHeader: vi.fn(),
  applyUrlProfile: (...args) => applyUrlProfile(...args),
}));
const track = vi.fn();
vi.mock('../utils/analytics', () => ({ track: (...args) => track(...args) }));
const fetchCredits = vi.fn();
vi.mock('./creditStore', () => ({ useCreditStore: { getState: () => ({ fetchCredits }) } }));
let urlProfile = null;
vi.mock('./editorStore', () => ({
  useEditorStore: { getState: () => ({ editorMode: 'annotate' }) },
  EDITOR_MODES: {},
  MODE_PATHS: {},
  parseEditorPath: () => ({ profileId: urlProfile }),
}));
vi.mock('./gamesDataStore', () => ({ useGamesDataStore: { getState: () => ({}) } }));
vi.mock('./projectsStore', () => ({ useProjectsStore: { getState: () => ({}) } }));

const { useAuthStore } = await import('./authStore');

describe('first sign-in on an editor URL with ?profile= (T14970)', () => {
  const reload = vi.fn();
  const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });

  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    vi.stubGlobal('location', { ...window.location, reload });
    useAuthStore.setState({ checkAdmin: vi.fn(), pendingAction: null, isAuthenticated: false });
  });

  it('keeps the login event and the pending action, without a reload', async () => {
    urlProfile = 'bbbbbbbb';
    const pendingAction = vi.fn();
    useAuthStore.setState({ pendingAction });

    useAuthStore.getState().onAuthSuccess('a@b.c', 'u1');
    await flush();

    expect(reload).not.toHaveBeenCalled();
    expect(track).toHaveBeenCalledWith('login');
    expect(pendingAction).toHaveBeenCalledOnce();
  });

  it('settles the profile before the session opens, so nothing loads in the wrong one', async () => {
    urlProfile = 'bbbbbbbb';
    let finish;
    applyUrlProfile.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));

    useAuthStore.getState().onAuthSuccess('a@b.c', 'u1');
    await flush();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);

    finish();
    await flush();
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
  });

  it('carries on at once everywhere else', () => {
    urlProfile = null;
    useAuthStore.getState().onAuthSuccess('a@b.c', 'u1');
    expect(applyUrlProfile).not.toHaveBeenCalled();
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(fetchCredits).toHaveBeenCalledOnce();
  });
});
