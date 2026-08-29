import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';

// T8020 request-count proof: mounting AdminScreen must fire exactly ONE network call
// (GET /api/admin/dashboard), not the five separate fetches it used to. This is the
// contained proxy for the task's "fresh HAR confirms reduced request count" criterion
// (a live HAR re-capture needs staging/prod and is deferred — see the task report).

vi.mock('../config', () => ({ API_BASE: '' }));

const mockApiFetch = vi.fn();
vi.mock('../utils/apiFetch', () => ({ default: (...args) => mockApiFetch(...args) }));

vi.mock('../stores/creditStore', () => ({
  useCreditStore: { getState: () => ({ fetchCredits: vi.fn() }) },
}));

// Stub the heavy admin child components — this test asserts the mount-time request count,
// not their rendering (they have their own tests).
vi.mock('../components/admin/UserTable', () => ({ UserTable: () => null }));
vi.mock('../components/admin/PulseCards', () => ({ PulseCards: () => null }));
vi.mock('../components/admin/FunnelChart', () => ({ FunnelChart: () => null }));
vi.mock('../components/admin/ChannelsTable', () => ({ ChannelsTable: () => null }));
vi.mock('../components/admin/CohortGrid', () => ({ CohortGrid: () => null }));
vi.mock('../components/admin/PlatformBreakdown', () => ({ PlatformBreakdown: () => null }));
vi.mock('../components/admin/UserDetailPanel', () => ({ UserDetailPanel: () => null }));
vi.mock('../components/admin/RevenueReconciliation', () => ({ RevenueReconciliation: () => null }));

import { AdminScreen } from './AdminScreen';
import { useAdminStore } from '../stores/adminStore';

const DASHBOARD = {
  users: { users: [], page: 1, total_pages: 1, total_users: 0, page_size: 10, funnel_totals: null },
  pulse: { cards: {}, days: 30 },
  channels: { channels: [] },
  cohorts: { cohorts: [] },
  platforms: { platforms: {}, by_action: {} },
};

describe('AdminScreen mount fetch consolidation (T8020)', () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
    mockApiFetch.mockResolvedValue({ ok: true, json: async () => DASHBOARD });
    useAdminStore.setState({ users: [], usersLoading: false, usersError: null });
  });

  it('fires exactly ONE request — GET /api/admin/dashboard — on mount, not five', async () => {
    render(<AdminScreen onBack={() => {}} />);

    // Wait for the mount effect's fetch to settle.
    await waitFor(() => expect(mockApiFetch).toHaveBeenCalled());

    expect(mockApiFetch).toHaveBeenCalledTimes(1);
    expect(mockApiFetch).toHaveBeenCalledWith('/api/admin/dashboard');

    // And specifically NOT any of the 5 individual endpoints the old effect hit.
    const urls = mockApiFetch.mock.calls.map(c => c[0]);
    expect(urls).not.toContain('/api/admin/users');
    expect(urls.some(u => u.startsWith('/api/admin/analytics/'))).toBe(false);
  });
});
