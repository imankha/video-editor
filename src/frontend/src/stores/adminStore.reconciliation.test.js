import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock config + apiFetch before importing the store (T5760).
vi.mock('../config', () => ({ API_BASE: '' }));

const mockApiFetch = vi.fn();
vi.mock('../utils/apiFetch', () => ({ default: (...args) => mockApiFetch(...args) }));

// creditStore is imported by adminStore; stub its fetchCredits so nothing hits network.
vi.mock('./creditStore', () => ({
  useCreditStore: { getState: () => ({ fetchCredits: vi.fn() }) },
}));

import { useAdminStore } from './adminStore';

const REPORT = {
  rows: [
    { user_id: 'user-a', email: 'a@x.com', local_cents: 699, stripe_net_cents: 399,
      delta_cents: 300, cause: 'refund', pi_count: 1, has_pending_dispute: false, drifted: true },
    { user_id: 'user-b', email: 'b@x.com', local_cents: 399, stripe_net_cents: 399,
      delta_cents: 0, cause: 'aligned', pi_count: 1, has_pending_dispute: false, drifted: false },
  ],
  summary: { total_users: 2, drifted_users: 1, aligned_users: 1,
             total_local_cents: 1098, total_stripe_net_cents: 798, total_delta_cents: 300 },
  go_live_date: '2026-07-22',
};

describe('adminStore revenue reconciliation (T5760)', () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
    useAdminStore.setState({ reconciliationData: null, reconciliationLoading: false, reconciliationError: null });
  });

  it('fetchReconciliation stores the on-demand report', async () => {
    mockApiFetch.mockResolvedValue({ ok: true, json: async () => REPORT });
    await useAdminStore.getState().fetchReconciliation();

    expect(mockApiFetch).toHaveBeenCalledWith('/api/admin/revenue-reconciliation');
    expect(useAdminStore.getState().reconciliationData.summary.drifted_users).toBe(1);
    expect(useAdminStore.getState().reconciliationLoading).toBe(false);
  });

  it('fetchReconciliation records an error and stops loading on failure', async () => {
    mockApiFetch.mockResolvedValue({ ok: false, status: 503, json: async () => ({ detail: 'Stripe not configured' }) });
    await useAdminStore.getState().fetchReconciliation();

    expect(useAdminStore.getState().reconciliationError).toBe('Stripe not configured');
    expect(useAdminStore.getState().reconciliationLoading).toBe(false);
  });

  it('healReconciliation POSTs the target and re-runs the report', async () => {
    // 1st call = heal POST, 2nd call = the fetchReconciliation refresh.
    mockApiFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ results: [{ user_id: 'user-a', old_cents: 699, new_cents: 399, healed: true }], healed: 1 }) })
      .mockResolvedValueOnce({ ok: true, json: async () => REPORT });

    const data = await useAdminStore.getState().healReconciliation({ userIds: ['user-a'] });

    expect(data.healed).toBe(1);
    const [url, opts] = mockApiFetch.mock.calls[0];
    expect(url).toBe('/api/admin/revenue-reconciliation/heal');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual({ user_ids: ['user-a'], all_drifted: false });
    // Report was refreshed (second call).
    expect(mockApiFetch).toHaveBeenCalledTimes(2);
    expect(mockApiFetch.mock.calls[1][0]).toBe('/api/admin/revenue-reconciliation');
  });

  it('healReconciliation all-drifted sends all_drifted flag', async () => {
    mockApiFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ results: [], healed: 2 }) })
      .mockResolvedValueOnce({ ok: true, json: async () => REPORT });

    await useAdminStore.getState().healReconciliation({ allDrifted: true });

    expect(JSON.parse(mockApiFetch.mock.calls[0][1].body)).toEqual({ user_ids: null, all_drifted: true });
  });
});
