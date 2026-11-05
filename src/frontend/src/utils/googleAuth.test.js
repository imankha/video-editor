import { describe, it, expect, vi, beforeEach } from 'vitest';

const { apiFetchMock, onAuthSuccess, diagMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn(), onAuthSuccess: vi.fn(), diagMock: vi.fn() }));
vi.mock('./apiFetch', () => ({ default: (...args) => apiFetchMock(...args) }));
vi.mock('./clientLogger', () => ({ reportClientDiagnostic: (...a) => diagMock(...a) }));
vi.mock('../stores/authStore', () => ({ useAuthStore: { getState: () => ({ onAuthSuccess }) } }));

import { ensureGisInitialized, onAuthPending, logSignInEnvironment } from './googleAuth';

// T11890: the only observable moment of a Google sign-in is the credential
// arriving; the sign-in screen shows "Signing you in..." from then.
describe('googleAuth pending signal', () => {
  let callback;
  beforeEach(() => {
    apiFetchMock.mockReset();
    diagMock.mockReset();
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

  it('T15100 the sign-in body carries the captured country', async () => {
    sessionStorage.setItem('campaignParams', JSON.stringify({ country: 'DE' }));
    apiFetchMock.mockResolvedValue({ ok: true, json: async () => ({ email: 'a@b.c', user_id: 'u' }) });
    await callback({ credential: 'tok' });
    sessionStorage.clear();
    expect(JSON.parse(apiFetchMock.mock.calls[0][1].body).country).toBe('DE');
  });

  it('goes back to false when the backend rejects the credential', async () => {
    apiFetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => ({ detail: 'bad' }) });
    const seen = [];
    const off = onAuthPending((p) => seen.push(p));
    await callback({ credential: 'tok' });
    off();
    expect(seen).toEqual([true, false]);
  });

  it('reports a diagnostic with status and detail when the backend rejects', async () => {
    apiFetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => ({ detail: 'bad' }) });
    await callback({ credential: 'tok' });
    expect(diagMock).toHaveBeenCalledWith('auth-diag', expect.stringContaining('backend_rejected status=401 detail=bad'));
  });

  it('reports a diagnostic when the callback fires without a credential', async () => {
    await callback({});
    expect(diagMock).toHaveBeenCalledWith('auth-diag', expect.stringContaining('credential_missing'));
  });

  it('logSignInEnvironment reports origin and GIS/FedCM presence', () => {
    logSignInEnvironment('button_rendered');
    expect(diagMock).toHaveBeenCalledWith('auth-diag', expect.stringMatching(/event=button_rendered origin=\S+ gis=true fedcm=\w+/));
  });
});

// T14360: the rendered button must use FedCM, not GIS's popup window, whose
// postMessage back to the opener Chrome reports as a red COOP error.
describe('googleAuth GIS init options', () => {
  it('opts both One Tap and the rendered button into FedCM', async () => {
    vi.resetModules();
    const initialize = vi.fn();
    window.google = { accounts: { id: { initialize } } };
    const fresh = await import('./googleAuth');
    fresh.ensureGisInitialized();
    expect(initialize).toHaveBeenCalledTimes(1);
    expect(initialize.mock.calls[0][0]).toMatchObject({
      use_fedcm_for_prompt: true,
      use_fedcm_for_button: true,
    });
  });
});
