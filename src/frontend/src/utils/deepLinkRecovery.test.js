import { describe, it, expect, beforeEach, vi } from 'vitest';

const toastInfo = vi.fn();
vi.mock('../components/shared', () => ({ toast: { info: (...a) => toastInfo(...a) } }));

const apiFetch = vi.fn();
vi.mock('./apiFetch', () => ({ default: (...a) => apiFetch(...a) }));

const ALL_PROFILES = [{ id: 'aaaaaaaa' }, { id: 'bbbbbbbb' }, { id: 'cccccccc' }];
const profileState = {
  profiles: ALL_PROFILES,
  // What the server calls current. The tab's header can differ; see tabProfile.
  currentProfileId: 'cccccccc',
  error: null,
  fetchProfiles: vi.fn(async () => {}),
  switchProfile: vi.fn(async (id) => { tabProfile = id; }),
};
let tabProfile = 'aaaaaaaa';
vi.mock('./sessionInit', () => ({ getProfileId: () => tabProfile }));
vi.mock('../stores/profileStore', () => ({ useProfileStore: { getState: () => profileState } }));

const fetchGames = vi.fn();
vi.mock('../stores/gamesDataStore', () => ({ useGamesDataStore: { getState: () => ({ fetchGames }) } }));

const redirectToGamesTab = vi.fn();
vi.mock('../stores/editorStore', () => ({
  useEditorStore: { getState: () => ({ redirectToGamesTab }) },
}));

const { recoverDeepLink, markBootstrapSettled, showUrlLandingNotice, RECOVERY } = await import('./deepLinkRecovery');
const { DEEP_LINK_KIND } = await import('../constants/deepLinkKinds');

// status per profile id; a thrown value simulates a dropped connection
function respondWith(byProfile) {
  apiFetch.mockImplementation(async (_url, { headers }) => {
    const status = byProfile[headers['X-Profile-ID']] ?? 404;
    if (status === 0) throw new TypeError('Failed to fetch');
    return { ok: status === 200, status };
  });
}

describe('recoverDeepLink (T14970)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tabProfile = 'aaaaaaaa';
    profileState.profiles = ALL_PROFILES;
    profileState.error = null;
    markBootstrapSettled();
  });

  it('switches to the profile that owns the id', async () => {
    respondWith({ bbbbbbbb: 200 });
    const outcome = await recoverDeepLink({ kind: DEEP_LINK_KIND.GAME, id: 12 });
    expect(outcome).toBe(RECOVERY.SWITCHED);
    expect(profileState.switchProfile).toHaveBeenCalledWith('bbbbbbbb');
    expect(redirectToGamesTab).not.toHaveBeenCalled();
    expect(toastInfo).not.toHaveBeenCalled();
  });

  it('asks about a project on the projects endpoint', async () => {
    respondWith({ cccccccc: 200 });
    await recoverDeepLink({ kind: DEEP_LINK_KIND.PROJECT, id: 7 });
    expect(apiFetch.mock.calls[0][0]).toMatch(/\/api\/projects\/7$/);
    expect(profileState.switchProfile).toHaveBeenCalledWith('cccccccc');
  });

  it('lands on the Games tab with the notice when no profile has the game', async () => {
    respondWith({});
    const outcome = await recoverDeepLink({ kind: DEEP_LINK_KIND.GAME, id: 12 });
    expect(outcome).toBe(RECOVERY.MISSING);
    expect(redirectToGamesTab).toHaveBeenCalledOnce();
    expect(toastInfo.mock.calls[0][0]).toBe('That game is no longer here');
    expect(fetchGames).toHaveBeenCalledOnce();
    expect(profileState.switchProfile).not.toHaveBeenCalled();
  });

  it('names a play in the notice for a project id', async () => {
    respondWith({});
    await recoverDeepLink({ kind: DEEP_LINK_KIND.PROJECT, id: 7 });
    expect(toastInfo.mock.calls[0][0]).toBe('That play is no longer here');
  });

  it('never calls a dropped connection "no longer here"', async () => {
    respondWith({ aaaaaaaa: 0 });
    expect(await recoverDeepLink({ kind: DEEP_LINK_KIND.GAME, id: 12 })).toBe(RECOVERY.UNAVAILABLE);
    expect(redirectToGamesTab).not.toHaveBeenCalled();
  });

  it('stays unavailable when another profile could not be checked', async () => {
    respondWith({ bbbbbbbb: 503 });
    expect(await recoverDeepLink({ kind: DEEP_LINK_KIND.GAME, id: 12 })).toBe(RECOVERY.UNAVAILABLE);
    expect(redirectToGamesTab).not.toHaveBeenCalled();
  });

  it('an empty profile list is unavailable, never "no longer here"', async () => {
    respondWith({});
    profileState.profiles = [];
    expect(await recoverDeepLink({ kind: DEEP_LINK_KIND.GAME, id: 12 })).toBe(RECOVERY.UNAVAILABLE);
    expect(redirectToGamesTab).not.toHaveBeenCalled();
    expect(toastInfo).not.toHaveBeenCalled();
  });

  it('a failed profile fetch is unavailable, even with a stale list in hand', async () => {
    respondWith({});
    profileState.fetchProfiles.mockImplementationOnce(async () => { profileState.error = 'Failed to fetch profiles: 503'; });
    expect(await recoverDeepLink({ kind: DEEP_LINK_KIND.GAME, id: 12 })).toBe(RECOVERY.UNAVAILABLE);
    expect(redirectToGamesTab).not.toHaveBeenCalled();
  });

  it('a one-profile account with a clean 404 is really missing', async () => {
    respondWith({});
    profileState.profiles = [{ id: 'aaaaaaaa' }];
    expect(await recoverDeepLink({ kind: DEEP_LINK_KIND.GAME, id: 12 })).toBe(RECOVERY.MISSING);
  });

  it("uses this tab's header profile as current, not the server's", async () => {
    tabProfile = 'bbbbbbbb';
    respondWith({ aaaaaaaa: 200 });
    expect(await recoverDeepLink({ kind: DEEP_LINK_KIND.GAME, id: 12 })).toBe(RECOVERY.SWITCHED);
    expect(apiFetch.mock.calls[0][1].headers['X-Profile-ID']).toBe('bbbbbbbb');
    expect(profileState.switchProfile).toHaveBeenCalledWith('aaaaaaaa');
  });

  it('a URL that names its profile is not searched for elsewhere', async () => {
    respondWith({ bbbbbbbb: 200 });
    const outcome = await recoverDeepLink({ kind: DEEP_LINK_KIND.GAME, id: 12, pinnedToProfile: true });
    expect(outcome).toBe(RECOVERY.MISSING);
    expect(apiFetch).toHaveBeenCalledOnce();
    expect(profileState.switchProfile).not.toHaveBeenCalled();
  });

  it('reports unavailable when the profile switch did not take', async () => {
    respondWith({ bbbbbbbb: 200 });
    profileState.switchProfile.mockImplementationOnce(async () => {});
    expect(await recoverDeepLink({ kind: DEEP_LINK_KIND.GAME, id: 12 })).toBe(RECOVERY.UNAVAILABLE);
  });
});

describe('showUrlLandingNotice (T14970)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does nothing when the notice was already taken, as a StrictMode re-run finds', () => {
    expect(() => showUrlLandingNotice(null)).not.toThrow();
    expect(toastInfo).not.toHaveBeenCalled();
  });

  it('says the object is gone', () => {
    showUrlLandingNotice({ kind: DEEP_LINK_KIND.PROJECT, unavailable: false });
    expect(toastInfo.mock.calls[0][0]).toBe('That play is no longer here');
  });
});

describe('bootstrap settling (T14970)', () => {
  const settled = async (promise) => {
    const winner = await Promise.race([
      promise.then(() => 'settled'),
      new Promise((resolve) => { setTimeout(() => resolve('hung'), 50); }),
    ]);
    return winner;
  };

  async function freshModule() {
    vi.resetModules();
    return import('./deepLinkRecovery');
  }

  it('recovery waits while bootstrap is running', async () => {
    const fresh = await freshModule();
    respondWith({});
    const recovery = fresh.recoverDeepLink({ kind: DEEP_LINK_KIND.GAME, id: 12 });
    expect(await settled(recovery)).toBe('hung');
    fresh.markBootstrapSettled();
    expect(await settled(recovery)).toBe('settled');
  });

  it('settles when the bootstrap work succeeds', async () => {
    const fresh = await freshModule();
    respondWith({});
    await fresh.settleBootstrapAfter(async () => {});
    expect(await settled(fresh.recoverDeepLink({ kind: DEEP_LINK_KIND.GAME, id: 12 }))).toBe('settled');
  });

  it('settles when the bootstrap work fails, and still reports the failure', async () => {
    const fresh = await freshModule();
    respondWith({});
    await expect(fresh.settleBootstrapAfter(async () => { throw new Error('init failed'); })).rejects.toThrow('init failed');
    expect(await settled(fresh.recoverDeepLink({ kind: DEEP_LINK_KIND.GAME, id: 12 }))).toBe('settled');
  });
});
