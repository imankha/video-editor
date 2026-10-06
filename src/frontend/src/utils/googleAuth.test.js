import { describe, it, expect, vi, beforeEach } from 'vitest';

const { apiFetchMock, onAuthSuccess } = vi.hoisted(() => ({ apiFetchMock: vi.fn(), onAuthSuccess: vi.fn() }));
vi.mock('./apiFetch', () => ({ default: (...args) => apiFetchMock(...args) }));
vi.mock('../stores/authStore', () => ({ useAuthStore: { getState: () => ({ onAuthSuccess }) } }));

import { ensureGisInitialized, onAuthPending } from './googleAuth';

// T11890: the only observable moment of a Google sign-in is the credential
// arriving; the sign-in screen shows "Signing you in..." from then.
describe('googleAuth pending signal', () => {
  let callback;
  beforeEach(() => {
    apiFetchMock.mockReset();
    window.google = { accounts: { id: { initialize: (cfg) => { callback = cfg.callback; } } } };
    ensureGisInitialized();
  });

  it('is true once a credential arrives and stays true on success', async () => {
    apiFetchMock.mockResolvedValue({ ok: true, json: async () => ({ email: 'a@b.c', user_id: 'u' }) });
    const seen = [];
    const off = onAuthPending((p) => seen.push(p));
    await callback({ credential: 'tok' });
    off();
    expect(seen).toEqual([true]);
  });

  it('goes back to false when the backend rejects the credential', async () => {
    apiFetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => ({ detail: 'bad' }) });
    const seen = [];
    const off = onAuthPending((p) => seen.push(p));
    await callback({ credential: 'tok' });
    off();
    expect(seen).toEqual([true, false]);
  });
});
