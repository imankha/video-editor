import { describe, it, expect, beforeEach, vi } from 'vitest';

// T7200: on a hard reload (impersonate/stop-impersonate use window.location.href
// navigation, so every reload goes through this path), setSessionState used to
// skip checkAdmin() whenever skipFetches was true. Nothing else ever supplies
// is_admin (GET /api/bootstrap has no such field), so isAdmin silently reset to
// false and never recovered. checkAdmin() must always run when authenticated.

vi.mock('../config', () => ({ API_BASE: '' }));

const mockFetch = vi.fn();
global.fetch = mockFetch;

vi.mock('../utils/sessionInit', () => ({
  getUserId: vi.fn(() => null),
  setUserId: vi.fn(),
  resetSession: vi.fn(),
  clearProfileHeader: vi.fn(),
  applyUrlProfile: vi.fn(),
}));
vi.mock('../utils/analytics', () => ({ track: vi.fn() }));
vi.mock('../utils/resumePoint', () => ({ suppressNextResumePointExit: vi.fn() }));

const h = vi.hoisted(() => ({
  fetchCredits: vi.fn(),
}));
vi.mock('./creditStore', () => ({
  useCreditStore: { getState: () => ({ fetchCredits: h.fetchCredits }) },
}));
vi.mock('./editorStore', () => ({
  useEditorStore: { getState: () => ({}) },
}));
vi.mock('./gamesDataStore', () => ({
  useGamesDataStore: { getState: () => ({}) },
}));
vi.mock('./projectsStore', () => ({
  useProjectsStore: { getState: () => ({}) },
}));

describe('authStore.setSessionState — admin recheck on reload (T7200)', () => {
  let useAuthStore;

  beforeEach(async () => {
    vi.resetModules();
    mockFetch.mockReset();
    h.fetchCredits.mockReset();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ is_admin: true, environment: 'dev' }),
    });
    ({ useAuthStore } = await import('./authStore'));
  });

  it('calls checkAdmin (GET /api/admin/me) even when skipFetches is true', async () => {
    useAuthStore.getState().setSessionState(true, 'a@b.com', null, null, { skipFetches: true });
    await vi.waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/admin/me', expect.anything());
    });
    await vi.waitFor(() => {
      expect(useAuthStore.getState().isAdmin).toBe(true);
    });
  });

  it('still skips fetchCredits when skipFetches is true (bootstrap covers it)', async () => {
    useAuthStore.getState().setSessionState(true, 'a@b.com', null, null, { skipFetches: true });
    await vi.waitFor(() => {
      expect(useAuthStore.getState().isAdmin).toBe(true);
    });
    expect(h.fetchCredits).not.toHaveBeenCalled();
  });

  it('calls both checkAdmin and fetchCredits when skipFetches is false', async () => {
    useAuthStore.getState().setSessionState(true, 'a@b.com', null, null, { skipFetches: false });
    await vi.waitFor(() => {
      expect(useAuthStore.getState().isAdmin).toBe(true);
    });
    expect(h.fetchCredits).toHaveBeenCalled();
  });

  it('does not call checkAdmin when not authenticated', () => {
    useAuthStore.getState().setSessionState(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// T14980: sign-out ruling (owner, 2026-11-08) -- the resume point row keeps the page the
// user was on right before signing out; no DELETE, and the exit beacon that would otherwise
// fire on this same reload must be suppressed.
describe('authStore.logout — resume point suppression (T14980)', () => {
  let useAuthStore;
  let suppressNextResumePointExit;

  beforeEach(async () => {
    vi.resetModules();
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
    Object.defineProperty(window, 'location', {
      value: { ...window.location, reload: vi.fn() },
      writable: true,
    });
    ({ useAuthStore } = await import('./authStore'));
    ({ suppressNextResumePointExit } = await import('../utils/resumePoint'));
  });

  it('suppresses the exit beacon before reloading', async () => {
    await useAuthStore.getState().logout();
    expect(suppressNextResumePointExit).toHaveBeenCalled();
    expect(window.location.reload).toHaveBeenCalled();
  });
});

// T14990: impersonation lands on the target's resume point instead of always '/'.
describe('authStore.buildImpersonationLandingUrl', () => {
  let buildImpersonationLandingUrl;

  beforeEach(async () => {
    vi.resetModules();
    ({ buildImpersonationLandingUrl } = await import('./authStore'));
  });

  it('builds the object path with ?profile= and ?t= from a resolved point', () => {
    const url = buildImpersonationLandingUrl({
      path: '/focus/p/8124', profile_id: 'prof-a', profile_name: 'Lucas', t: 37.2,
    });
    expect(url).toBe('/focus/p/8124?profile=prof-a&t=37.2');
  });

  it('adds the one-shot ?dialog= param when the point recorded one', () => {
    const url = buildImpersonationLandingUrl({
      path: '/annotate/g/5', profile_id: 'prof-a', profile_name: 'Lucas', dialog: 'Insufficient credits',
    });
    expect(url).toContain('dialog=Insufficient+credits');
  });

  it('falls back to / when there is no point', () => {
    expect(buildImpersonationLandingUrl(null)).toBe('/');
  });

  it('falls back to / for a home/project-manager point with no object (no profile needed)', () => {
    expect(buildImpersonationLandingUrl({ path: '/', profile_id: null })).toBe('/');
  });

  it('falls back to / for an object path whose profile did not resolve (deleted since the point was written)', () => {
    const url = buildImpersonationLandingUrl({ path: '/annotate/g/5', profile_id: 'prof-gone', profile_name: null });
    expect(url).toBe('/');
  });
});

describe('authStore.startImpersonation (T14990)', () => {
  let useAuthStore;
  let clearProfileHeader;

  beforeEach(async () => {
    vi.resetModules();
    mockFetch.mockReset();
    sessionStorage.clear();
    Object.defineProperty(window, 'location', {
      value: { ...window.location, href: '' },
      writable: true,
    });
    ({ useAuthStore } = await import('./authStore'));
    ({ clearProfileHeader } = await import('../utils/sessionInit'));
  });

  it('lands on the target resume point and snapshots it for the banner', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true, target_user_id: 'u1', target_email: 'u1@test.local', ttl_minutes: 60,
        resume_point: { path: '/focus/p/8124', profile_id: 'prof-a', profile_name: 'Lucas', t: 37 },
      }),
    });

    await useAuthStore.getState().startImpersonation('u1');

    expect(clearProfileHeader).toHaveBeenCalled();
    expect(window.location.href).toBe('/focus/p/8124?profile=prof-a&t=37');
    expect(JSON.parse(sessionStorage.getItem('rb_impersonation_landing_point')).path).toBe('/focus/p/8124');
  });

  it('T15580: still snapshots a resume point whose profile did not resolve, so the banner can offer the link', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true, target_user_id: 'u1', target_email: 'u1@test.local', ttl_minutes: 60,
        resume_point: { path: '/overlay/p/2', profile_id: null, profile_name: null },
      }),
    });

    await useAuthStore.getState().startImpersonation('u1');

    expect(window.location.href).toBe('/');
    expect(JSON.parse(sessionStorage.getItem('rb_impersonation_landing_point')).path).toBe('/overlay/p/2');
  });

  it('lands on / and stores no snapshot when the target has no resume point', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, target_user_id: 'u1', target_email: 'u1@test.local', ttl_minutes: 60, resume_point: null }),
    });

    await useAuthStore.getState().startImpersonation('u1');

    expect(window.location.href).toBe('/');
    expect(sessionStorage.getItem('rb_impersonation_landing_point')).toBeNull();
  });
});

describe('authStore.getImpersonationLandingPoint (T14990)', () => {
  let getImpersonationLandingPoint;

  beforeEach(async () => {
    vi.resetModules();
    sessionStorage.clear();
    ({ getImpersonationLandingPoint } = await import('./authStore'));
  });

  it('reads back the stored snapshot', () => {
    sessionStorage.setItem('rb_impersonation_landing_point', JSON.stringify({ path: '/focus/p/8124' }));
    expect(getImpersonationLandingPoint()).toEqual({ path: '/focus/p/8124' });
  });

  it('returns null when nothing was stored', () => {
    expect(getImpersonationLandingPoint()).toBeNull();
  });
});
