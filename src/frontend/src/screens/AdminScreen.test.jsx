import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, waitFor, screen, fireEvent } from '@testing-library/react';

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
// T13990: the dimension tables render a marker + one row button so the tests can see
// which table is mounted and drive a row selection through the real click handler.
vi.mock('../components/admin/ChannelsTable', () => ({
  ChannelsTable: ({ onRowClick }) => (
    <div data-testid="channels-table">
      <button onClick={() => onRowClick('abc123')}>campaign-row</button>
    </div>
  ),
}));
vi.mock('../components/admin/CohortGrid', () => ({
  CohortGrid: ({ onRowClick }) => (
    <div data-testid="cohort-grid">
      <button onClick={() => onRowClick('2026-10-05')}>cohort-row</button>
    </div>
  ),
}));
vi.mock('../components/admin/PlatformBreakdown', () => ({ PlatformBreakdown: () => null }));
vi.mock('../components/admin/UserDetailPanel', () => ({ UserDetailPanel: () => null }));
vi.mock('../components/admin/RevenueReconciliation', () => ({ RevenueReconciliation: () => null }));

import { AdminScreen } from './AdminScreen';
import { useAdminStore } from '../stores/adminStore';

const DASHBOARD = {
  users: { users: [], page: 1, total_pages: 1, total_users: 0, page_size: 10, funnel_totals: null },
  pulse: { cards: {}, days: 30 },
  channels: { channels: [{ origin: 'abc123', campaign_name: 'Spring Promo' }] },
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
    // T8110: dashboard fetch now carries exclude_test (Real pill, default ON).
    expect(mockApiFetch).toHaveBeenCalledWith('/api/admin/dashboard?exclude_test=true');

    // And specifically NOT any of the 5 individual endpoints the old effect hit.
    const urls = mockApiFetch.mock.calls.map(c => c[0]);
    expect(urls).not.toContain('/api/admin/users');
    expect(urls.some(u => u.startsWith('/api/admin/analytics/'))).toBe(false);
  });
});

// Row clicks refetch users + pulse through their own endpoints; answer each URL with its shape.
function routeFetch(dashboard) {
  return async (url) => ({
    ok: true,
    json: async () => {
      if (url.startsWith('/api/admin/dashboard')) return dashboard;
      if (url.startsWith('/api/admin/users')) return DASHBOARD.users;
      if (url.startsWith('/api/admin/analytics/pulse')) return DASHBOARD.pulse;
      if (url.startsWith('/api/admin/analytics/cohorts')) return DASHBOARD.cohorts;
      if (url.startsWith('/api/admin/analytics/channels')) return DASHBOARD.channels;
      throw new Error(`unrouted ${url}`);
    },
  });
}

describe('AdminScreen dimension selector (T13990)', () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
    mockApiFetch.mockImplementation(routeFetch(DASHBOARD));
    useAdminStore.setState({
      users: [], usersLoading: false, usersError: null,
      dimension: 'campaigns',
      segmentOrigin: null, segmentFrom: null, segmentTo: null, userFilter: null,
      channelsData: null, cohortsData: null,
    });
  });

  async function mount() {
    render(<AdminScreen onBack={() => {}} />);
    await screen.findByTestId('channels-table');
  }

  it('shows exactly one dimension table at a time; the pill row marks it', async () => {
    await mount();
    expect(screen.queryByTestId('cohort-grid')).toBeNull();
    expect(screen.getByRole('button', { name: 'Campaigns' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Cohorts' }).getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(screen.getByRole('button', { name: 'Cohorts' }));
    expect(screen.getByTestId('cohort-grid')).toBeTruthy();
    expect(screen.queryByTestId('channels-table')).toBeNull();
    expect(screen.getByRole('button', { name: 'Cohorts' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Campaigns' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('Builds pill is present but disabled until build capture lands (T14000)', async () => {
    await mount();
    const builds = screen.getByRole('button', { name: 'Builds' });
    expect(builds.disabled).toBe(true);
    expect(builds.getAttribute('title')).toBe('Build capture lands with T14000');
  });

  it('switching to a dimension the dashboard already loaded fires no request', async () => {
    await mount();
    expect(mockApiFetch).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Cohorts' }));
    fireEvent.click(screen.getByRole('button', { name: 'Campaigns' }));
    expect(mockApiFetch).toHaveBeenCalledTimes(1);
  });

  it('switching to an unloaded dimension fires its request exactly once', async () => {
    mockApiFetch.mockImplementation(routeFetch({ ...DASHBOARD, cohorts: null }));
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Cohorts' }));
    await screen.findByTestId('cohort-grid');
    fireEvent.click(screen.getByRole('button', { name: 'Campaigns' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cohorts' }));
    await screen.findByTestId('cohort-grid');

    const cohortCalls = mockApiFetch.mock.calls.filter(c => c[0].startsWith('/api/admin/analytics/cohorts'));
    expect(cohortCalls).toHaveLength(1);
  });

  it('a cohort row clears the campaign selection and vice versa; the hidden selection shows as a chip', async () => {
    await mount();
    fireEvent.click(screen.getByText('campaign-row'));
    expect(useAdminStore.getState().segmentOrigin).toBe('abc123');

    // Campaign table hidden: the applied campaign is still visible as a chip.
    fireEvent.click(screen.getByRole('button', { name: 'Cohorts' }));
    expect(useAdminStore.getState().segmentOrigin).toBe('abc123');
    expect(screen.getByTestId('active-selection-chip').textContent).toContain('Spring Promo');

    fireEvent.click(screen.getByText('cohort-row'));
    let s = useAdminStore.getState();
    expect(s.segmentOrigin).toBeNull();
    expect(s.segmentFrom).toBe('2026-10-05');
    expect(s.segmentTo).toBe('2026-10-11');

    fireEvent.click(screen.getByRole('button', { name: 'Campaigns' }));
    expect(screen.getByTestId('active-selection-chip').textContent).toContain('2026-10-05');

    fireEvent.click(screen.getByText('campaign-row'));
    s = useAdminStore.getState();
    expect(s.segmentOrigin).toBe('abc123');
    expect(s.segmentFrom).toBeNull();
    expect(s.segmentTo).toBeNull();
  });

  it('a fresh store (reload) starts on the Campaigns dimension', async () => {
    useAdminStore.setState({ dimension: 'cohorts' });
    vi.resetModules();
    const fresh = await import('../stores/adminStore');
    expect(fresh.useAdminStore.getState().dimension).toBe('campaigns');
  });
});
