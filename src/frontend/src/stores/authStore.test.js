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
}));
vi.mock('../utils/analytics', () => ({ track: vi.fn() }));

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
