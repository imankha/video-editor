import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock config + apiFetch before importing the store (mirrors adminStore.reconciliation.test.js).
vi.mock('../config', () => ({ API_BASE: '' }));

const mockApiFetch = vi.fn();
vi.mock('../utils/apiFetch', () => ({ default: (...args) => mockApiFetch(...args) }));

// creditStore is imported by adminStore; stub so nothing hits network.
vi.mock('./creditStore', () => ({
  useCreditStore: { getState: () => ({ fetchCredits: vi.fn() }) },
}));

import { useAdminStore } from './adminStore';

// Combined GET /api/admin/dashboard payload — the 5 individual sections nested under one key.
const DASHBOARD = {
  users: {
    users: [{ user_id: 'user-a', email: 'a@x.com' }],
    page: 2,
    total_pages: 4,
    total_users: 37,
    page_size: 10,
    funnel_totals: { signed_up: 37 },
  },
  pulse: { cards: { signups: {} }, days: 30 },
  channels: { channels: [{ origin: 'organic' }] },
  cohorts: { cohorts: [{ period: '2026-08-01' }] },
  platforms: { platforms: { mobile: 0.5 }, by_action: {} },
};

describe('adminStore.fetchDashboard (T8020)', () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
    useAdminStore.setState({
      users: [], usersLoading: false, usersError: null,
      currentPage: 1, totalPages: 1, totalUsers: 0, pageSize: 10, funnelTotals: null,
      pulseData: null, pulseLoading: false,
      channelsData: null, channelsLoading: false,
      cohortsData: null, cohortsLoading: false,
      platformsData: null, platformsLoading: false,
    });
  });

  it('fires ONE request to /api/admin/dashboard and fans it into the 5 existing state fields', async () => {
    mockApiFetch.mockResolvedValue({ ok: true, json: async () => DASHBOARD });

    await useAdminStore.getState().fetchDashboard();

    // Exactly one network call — the whole point of the consolidation.
    expect(mockApiFetch).toHaveBeenCalledTimes(1);
    // T8110: dashboard fetch now carries exclude_test (Real pill, default ON).
    expect(mockApiFetch).toHaveBeenCalledWith('/api/admin/dashboard?exclude_test=true');

    const s = useAdminStore.getState();
    // users section fanned out with the SAME mapping fetchUsers uses.
    expect(s.users).toEqual([{ user_id: 'user-a', email: 'a@x.com' }]);
    expect(s.currentPage).toBe(2);
    expect(s.totalPages).toBe(4);
    expect(s.totalUsers).toBe(37);
    expect(s.pageSize).toBe(10);
    expect(s.funnelTotals).toEqual({ signed_up: 37 });
    // the other 4 sections land in their own *Data fields.
    expect(s.pulseData).toEqual(DASHBOARD.pulse);
    expect(s.channelsData).toEqual(DASHBOARD.channels);
    expect(s.cohortsData).toEqual(DASHBOARD.cohorts);
    expect(s.platformsData).toEqual(DASHBOARD.platforms);
    // all 5 loading flags cleared.
    expect(s.usersLoading).toBe(false);
    expect(s.pulseLoading).toBe(false);
    expect(s.channelsLoading).toBe(false);
    expect(s.cohortsLoading).toBe(false);
    expect(s.platformsLoading).toBe(false);
  });

  it('null funnel_totals maps to null (mirrors fetchUsers)', async () => {
    mockApiFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ ...DASHBOARD, users: { ...DASHBOARD.users, funnel_totals: undefined } }),
    });
    await useAdminStore.getState().fetchDashboard();
    expect(useAdminStore.getState().funnelTotals).toBeNull();
  });

  it('on error sets usersError and clears every loading flag', async () => {
    mockApiFetch.mockResolvedValue({ ok: false, status: 500 });

    await useAdminStore.getState().fetchDashboard();

    const s = useAdminStore.getState();
    expect(s.usersError).toBe('HTTP 500');
    expect(s.usersLoading).toBe(false);
    expect(s.pulseLoading).toBe(false);
    expect(s.channelsLoading).toBe(false);
    expect(s.cohortsLoading).toBe(false);
    expect(s.platformsLoading).toBe(false);
  });
});
