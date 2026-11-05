import { describe, it, expect, vi, beforeEach } from 'vitest';

// T14970: an editor URL's ?profile= is set before anything loads. It is held in this tab
// only, so opening a link never changes the account's active profile.

const OWNED = 'bbbbbbbb';
const ACTIVE = 'aaaaaaaa';

const rejectUrlProfile = vi.fn();
vi.mock('../stores/editorStore', () => ({
  parseEditorPath: () => {
    const url = new URL(window.location.href);
    const object = /^\/(annotate\/g|focus\/p|overlay\/p)\/\d+$/.test(url.pathname);
    return { profileId: object ? url.searchParams.get('profile') : null };
  },
  useEditorStore: { getState: () => ({ rejectUrlProfile }) },
}));

const setSessionState = vi.fn();
vi.mock('../stores/authStore', () => ({
  useAuthStore: { getState: () => ({ setSessionState, needsTermsAcceptance: false }), setState: vi.fn() },
}));

function backend({ profilesStatus = 200 } = {}) {
  return vi.fn(async (input, init = {}) => {
    const url = String(input);
    if (url.includes('/api/auth/me')) return { ok: true, status: 200, json: async () => ({ user_id: 'u1' }) };
    if (url.includes('/api/auth/init')) return { ok: true, status: 200, json: async () => ({ profile_id: ACTIVE }) };
    if (url.includes('/api/profiles')) {
      return { ok: profilesStatus === 200, status: profilesStatus, json: async () => ({ profiles: [{ id: ACTIVE }, { id: OWNED }] }) };
    }
    throw new Error(`unexpected ${init.method ?? 'GET'} ${url}`);
  });
}

async function start(url, options) {
  window.history.replaceState({}, '', url);
  const fetchMock = backend(options);
  window.fetch = fetchMock;
  const session = await import('./sessionInit');
  const { profileReady } = await session.initSession();
  await profileReady;
  return { session, fetchMock };
}

describe('sessionInit: ?profile= on an editor URL (T14970)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    sessionStorage.clear();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('uses an owned profile for this tab before the session is announced', { timeout: 30000 }, async () => {
    const order = [];
    let session;
    setSessionState.mockImplementation(() => order.push(session?.getProfileId()));
    window.history.replaceState({}, '', `/annotate/g/1?profile=${OWNED}`);
    window.fetch = backend();
    session = await import('./sessionInit');
    await (await session.initSession()).profileReady;

    expect(session.getProfileId()).toBe(OWNED);
    expect(order).toEqual([OWNED]);
    expect(rejectUrlProfile).not.toHaveBeenCalled();
  });

  it('never writes the active profile', async () => {
    const { fetchMock } = await start(`/focus/p/1?profile=${OWNED}`);
    const writes = fetchMock.mock.calls.filter(([url, init]) => String(url).includes('/api/profiles') && init?.method);
    expect(writes).toEqual([]);
  });

  it('refuses an unowned profile and keeps the active one for the landing', async () => {
    const { session } = await start('/annotate/g/1?profile=ffffffff');
    expect(session.getProfileId()).toBe(ACTIVE);
    expect(rejectUrlProfile).toHaveBeenCalledWith({ kind: 'game', unavailable: false });
  });

  it('names a play for an unowned profile on a play URL', async () => {
    await start('/overlay/p/1?profile=ffffffff');
    expect(rejectUrlProfile).toHaveBeenCalledWith({ kind: 'project', unavailable: false });
  });

  it('never opens the object when ownership cannot be checked', async () => {
    const { session } = await start(`/annotate/g/1?profile=${OWNED}`, { profilesStatus: 503 });
    expect(session.getProfileId()).toBe(ACTIVE);
    expect(rejectUrlProfile).toHaveBeenCalledWith({ kind: 'game', unavailable: true });
  }, 15000);

  it('skips the check when the URL names the active profile', async () => {
    const { fetchMock } = await start(`/annotate/g/1?profile=${ACTIVE}`);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/api/profiles'))).toBe(false);
  });

  it('leaves an old bookmark and the email link to their own paths', async () => {
    const { session } = await start(`/?game=1&profile=${OWNED}`);
    expect(session.getProfileId()).toBe(ACTIVE);
    expect(rejectUrlProfile).not.toHaveBeenCalled();
  });
});

describe('applyUrlProfile, for a sign-in that skips startup (T14970)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    sessionStorage.clear();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  async function signIn(url, options) {
    window.history.replaceState({}, '', url);
    window.fetch = backend(options);
    const session = await import('./sessionInit');
    await session.applyUrlProfile();
    return session;
  }

  it('uses an owned profile for this tab', { timeout: 30000 }, async () => {
    const session = await signIn(`/annotate/g/1?profile=${OWNED}`);
    expect(session.getProfileId()).toBe(OWNED);
    expect(rejectUrlProfile).not.toHaveBeenCalled();
  });

  it('refuses an unowned profile', async () => {
    const session = await signIn('/focus/p/1?profile=ffffffff');
    expect(session.getProfileId()).toBeNull();
    expect(rejectUrlProfile).toHaveBeenCalledWith({ kind: 'project', unavailable: false });
  });
});

describe('withTabProfile (T14970)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    sessionStorage.clear();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('names the profile even when the tab matches the account right now', async () => {
    // Another tab can switch the account at any moment, and this tab would not hear about it.
    const { session } = await start('/home/games');
    expect(session.withTabProfile('/api/games/1/video')).toBe(`/api/games/1/video?profile_id=${ACTIVE}`);
  });

  it('keeps a media fragment after the profile', async () => {
    const { session } = await start('/home/games');
    expect(session.withTabProfile('/api/games/1/video#t=60')).toBe(`/api/games/1/video?profile_id=${ACTIVE}#t=60`);
  });

  it('names the tab profile on media URLs, which cannot send the header', async () => {
    const { session } = await start(`/annotate/g/1?profile=${OWNED}`);
    expect(session.withTabProfile('/api/games/1/video')).toBe(`/api/games/1/video?profile_id=${OWNED}`);
    expect(session.withTabProfile('/api/x/stream?a=1')).toBe(`/api/x/stream?a=1&profile_id=${OWNED}`);
  });

  it('leaves presigned and blob URLs alone', async () => {
    const { session } = await start(`/annotate/g/1?profile=${OWNED}`);
    expect(session.withTabProfile('https://r2.example/x.mp4?sig=1')).toBe('https://r2.example/x.mp4?sig=1');
    expect(session.withTabProfile('blob:abc')).toBe('blob:abc');
  });
});
