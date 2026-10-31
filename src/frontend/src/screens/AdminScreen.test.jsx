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
vi.mock('../components/admin/BuildsGrid', () => ({
  BuildsGrid: ({ onRowClick }) => (
    <div data-testid="builds-grid">
      <button onClick={() => onRowClick(4812)}>build-row</button>
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

// T14010: minimal real /analytics/journey payload; JourneyTab renders it unstubbed.
const JOURNEY = {
  nodes: [{
    key: 'signed_up', label: 'Signed up', band: 'get_footage_in', client_beacon: false,
    reached: 3, continued: 0, in_window: 1, stuck: 1, gone: 1, judged: 2,
    continue_rate: { pct: null, k: 0, n: 2 }, partial_from: null, no_data: false,
  }],
  edges: [],
  bands: [{ key: 'get_footage_in', label: 'Get footage in' }],
  loss: [],
  money: { nodes: [], edges: [] },
  meta: { window_days: 14, inactive_days: 14 },
};

describe('AdminScreen mount fetch consolidation (T8020)', () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
    mockApiFetch.mockResolvedValue({ ok: true, json: async () => DASHBOARD });
    useAdminStore.setState({ users: [], usersLoading: false, usersError: null });
  });

  it('fires the dashboard request plus exactly one Journey read on mount, nothing else', async () => {
    mockApiFetch.mockImplementation(routeFetch(DASHBOARD));
    render(<AdminScreen onBack={() => {}} />);

    await waitFor(() => expect(mockApiFetch).toHaveBeenCalledTimes(2));

    // T8110: dashboard fetch now carries exclude_test (Real pill, default ON).
    expect(mockApiFetch).toHaveBeenCalledWith('/api/admin/dashboard?exclude_test=true');
    // T14010: the Journey section is open by default and owns its own read. That is the
    // ONLY analytics call on mount; the 5 endpoints T8020 consolidated stay consolidated.
    const urls = mockApiFetch.mock.calls.map(c => c[0]);
    const analytics = urls.filter(u => u.startsWith('/api/admin/analytics/'));
    expect(analytics).toHaveLength(1);
    expect(analytics[0].startsWith('/api/admin/analytics/journey?')).toBe(true);
    expect(urls).not.toContain('/api/admin/users');
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
      if (url.startsWith('/api/admin/analytics/builds')) return { builds: [], unattributed_revenue_cents: 0 };
      if (url.startsWith('/api/admin/analytics/platforms')) return DASHBOARD.platforms;
      if (url.startsWith('/api/admin/analytics/journey')) return JOURNEY;
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
      segmentOrigin: null, segmentFrom: null, segmentTo: null, segmentBuild: null, userFilter: null,
      channelsData: null, cohortsData: null, buildsData: null,
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

  it('Builds pill shows the builds grid, fetched once on first open (T14000)', async () => {
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Builds' }));
    await screen.findByTestId('builds-grid');
    fireEvent.click(screen.getByRole('button', { name: 'Campaigns' }));
    fireEvent.click(screen.getByRole('button', { name: 'Builds' }));
    await screen.findByTestId('builds-grid');
    const buildCalls = mockApiFetch.mock.calls.filter(c => c[0].startsWith('/api/admin/analytics/builds'));
    expect(buildCalls).toHaveLength(1);
  });

  it('a build row filters users, pulse and platforms to that build; Clear all removes it (T14000)', async () => {
    await mount();
    fireEvent.click(screen.getByText('campaign-row'));
    fireEvent.click(screen.getByRole('button', { name: 'Builds' }));
    await screen.findByTestId('builds-grid');
    mockApiFetch.mockClear();

    fireEvent.click(screen.getByText('build-row'));
    let s = useAdminStore.getState();
    expect(s.segmentBuild).toBe(4812);
    expect(s.segmentOrigin).toBeNull();
    const urls = mockApiFetch.mock.calls.map(c => c[0]);
    for (const path of ['/api/admin/users?', '/api/admin/analytics/pulse?', '/api/admin/analytics/platforms?']) {
      const url = urls.find(u => u.startsWith(path));
      expect(url, path).toBeTruthy();
      expect(new URLSearchParams(url.split('?')[1]).get('build')).toBe('4812');
    }

    fireEvent.click(screen.getByRole('button', { name: 'Campaigns' }));
    expect(screen.getByTestId('active-selection-chip').textContent).toContain('Build #4812');

    mockApiFetch.mockClear();
    fireEvent.click(screen.getByText('Clear all'));
    s = useAdminStore.getState();
    expect(s.segmentBuild).toBeNull();
    const after = mockApiFetch.mock.calls.map(c => c[0]);
    const platforms = after.find(u => u.startsWith('/api/admin/analytics/platforms'));
    expect(platforms).toBeTruthy();
    expect(platforms).not.toContain('build=');
  });

  it('a campaign or cohort row clears the build selection (T14000)', async () => {
    useAdminStore.setState({ dimension: 'builds' });
    render(<AdminScreen onBack={() => {}} />);
    await screen.findByTestId('builds-grid');
    fireEvent.click(screen.getByText('build-row'));
    fireEvent.click(screen.getByRole('button', { name: 'Cohorts' }));
    fireEvent.click(screen.getByText('cohort-row'));
    expect(useAdminStore.getState().segmentBuild).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Builds' }));
    fireEvent.click(await screen.findByText('build-row'));
    fireEvent.click(screen.getByRole('button', { name: 'Campaigns' }));
    fireEvent.click(screen.getByText('campaign-row'));
    expect(useAdminStore.getState().segmentBuild).toBeNull();
  });

  it('switching to a dimension the dashboard already loaded fires no request', async () => {
    await mount();
    // T14010: mount = dashboard + the open Journey section's read; settle both first.
    await waitFor(() => expect(mockApiFetch).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: 'Cohorts' }));
    fireEvent.click(screen.getByRole('button', { name: 'Campaigns' }));
    expect(mockApiFetch).toHaveBeenCalledTimes(2);
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

describe('AdminScreen Journey section (T14010)', () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
    mockApiFetch.mockImplementation(routeFetch(DASHBOARD));
    useAdminStore.setState({ users: [], usersLoading: false, usersError: null, journeyData: null });
  });

  it('renders an open "Journey" section with the Journey map, and no Funnel section', async () => {
    render(<AdminScreen onBack={() => {}} />);
    expect(screen.getByRole('button', { name: 'Journey' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Funnel' })).toBeNull();
    // Open by default: the map renders from the journey read without a click.
    expect(await screen.findByTestId('journey-flow')).toBeTruthy();
    expect(screen.getByLabelText('Conversion window')).toBeTruthy();
  });
});
