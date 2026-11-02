import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../config', () => ({ API_BASE: '' }));
const h = vi.hoisted(() => ({ apiFetch: vi.fn(), clearProfileHeader: vi.fn() }));
vi.mock('./apiFetch', () => ({ default: h.apiFetch }));
vi.mock('./sessionInit', () => ({ clearProfileHeader: h.clearProfileHeader }));

import { probeDevAccounts, loginAsDevPreset, DEV_ACCOUNT_PARAM } from './devAccounts';

const res = (status, body = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

describe('devAccounts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.setItem('rb_profile_id', 'p1');
    window.history.replaceState({}, '', '/?dev_account=full&x=1');
  });

  it('probe 200 returns presets and stackId', async () => {
    const presets = [{ id: 'empty', label: 'Empty', available: true }];
    h.apiFetch.mockResolvedValue(res(200, { stack_id: 's1', presets }));
    expect(await probeDevAccounts()).toEqual({ presets, stackId: 's1' });
  });

  it.each([404, 401])('probe %i returns null', async (s) => {
    h.apiFetch.mockResolvedValue(res(s));
    expect(await probeDevAccounts()).toBeNull();
  });

  it('probe network error returns null', async () => {
    h.apiFetch.mockRejectedValue(new Error('down'));
    expect(await probeDevAccounts()).toBeNull();
  });

  it('successful login clears profile header and navigates without the param', async () => {
    h.apiFetch.mockResolvedValue(res(200, { user_id: 'u' }));
    const replace = vi.fn();
    vi.stubGlobal('location', { ...window.location, href: window.location.href, replace });
    await loginAsDevPreset('empty');
    expect(h.apiFetch.mock.calls[0][0]).toContain('/api/auth/dev-accounts/empty');
    expect(h.apiFetch.mock.calls[0][1]).toMatchObject({ method: 'POST', rbNonDataWrite: true });
    expect(h.clearProfileHeader).toHaveBeenCalled();
    const url = replace.mock.calls[0][0];
    expect(url).not.toContain(DEV_ACCOUNT_PARAM);
    expect(url).toContain('x=1');
    vi.unstubAllGlobals();
  });

  it('failed login throws backend detail and does not navigate', async () => {
    h.apiFetch.mockResolvedValue(res(409, { code: 'template_missing', detail: 'no template' }));
    const replace = vi.fn();
    vi.stubGlobal('location', { ...window.location, href: window.location.href, replace });
    await expect(loginAsDevPreset('full')).rejects.toThrow('no template');
    expect(replace).not.toHaveBeenCalled();
    expect(h.clearProfileHeader).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
