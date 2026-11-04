import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';

// T14740: real store, real JourneyTab. The URL sent to /api/admin/users is the proof.

vi.mock('../config', () => ({ API_BASE: '' }));
const mockApiFetch = vi.fn();
vi.mock('../utils/apiFetch', () => ({ default: (...args) => mockApiFetch(...args) }));
vi.mock('../stores/creditStore', () => ({
  useCreditStore: { getState: () => ({ fetchCredits: vi.fn() }) },
}));

let tableUsers = [];
vi.mock('../components/admin/UserTable', () => ({
  UserTable: ({ users }) => { tableUsers = users; return <div data-testid="user-table" />; },
}));
vi.mock('../components/admin/PulseCards', () => ({ PulseCards: () => null }));
vi.mock('../components/admin/ChannelsTable', () => ({
  ChannelsTable: ({ onRowClick }) => <button onClick={() => onRowClick('abc123')}>campaign-row</button>,
}));
vi.mock('../components/admin/CohortGrid', () => ({ CohortGrid: () => null }));
vi.mock('../components/admin/BuildsGrid', () => ({ BuildsGrid: () => null }));
vi.mock('../components/admin/PlatformBreakdown', () => ({ PlatformBreakdown: () => null }));
vi.mock('../components/admin/UserDetailPanel', () => ({ UserDetailPanel: () => null }));
vi.mock('../components/admin/RevenueReconciliation', () => ({ RevenueReconciliation: () => null }));

import { AdminScreen } from './AdminScreen';
import { useAdminStore } from '../stores/adminStore';

const USERS = { users: [{ user_id: 'a', email: 'a@x.com' }], page: 1, total_pages: 1, total_users: 1, page_size: 10, funnel_totals: null };
const JOURNEY = {
  nodes: [
    { key: 'signed_up', label: 'Signed up', band: 'b', major: true, client_beacon: false, reached: 9, continued: 3,
      in_window: 0, stuck: 0, gone: 6, judged: 9, continue_rate: { pct: null, k: 3, n: 9 }, partial_from: null, no_data: false },
    { key: 'clipped', label: 'First play', band: 'b', major: true, client_beacon: false, reached: 3, continued: 0,
      in_window: 0, stuck: 3, gone: 0, judged: 3, continue_rate: { pct: null, k: 0, n: 3 }, partial_from: null, no_data: false },
  ],
  edges: [{ from: 'signed_up', to: 'clipped', users: 3 }],
  bands: [{ key: 'b', label: 'Band' }],
  loss: [{ stage: 'signed_up', label: 'Signed up', lost: 6, stuck: 0, gone: 6, still_visiting: 0, judged: 9 }],
  money: { nodes: [], edges: [] },
  meta: { window_days: 14, inactive_days: 14 },
};
const DASHBOARD = { users: USERS, pulse: { cards: {}, days: 30 },
  channels: { channels: [{ origin: 'abc123', campaign_name: 'Spring' }] }, cohorts: { cohorts: [] },
  platforms: { platforms: {}, by_action: {} } };

const usersCalls = () => mockApiFetch.mock.calls.map(c => c[0]).filter(u => u.startsWith('/api/admin/users?'));
const lastUsersParams = () => new URLSearchParams(usersCalls().at(-1).split('?')[1]);
const chip = () => screen.queryByTestId('journey-user-chip');

async function mount() {
  render(<AdminScreen onBack={() => {}} />);
  await screen.findByTestId('journey-drop-label-signed_up-gone');
}
async function clickGone() {
  await act(async () => { fireEvent.click(screen.getByTestId('journey-drop-label-signed_up-gone')); });
  await waitFor(() => expect(usersCalls().length).toBeGreaterThan(0));
}

describe('Journey drop-off filter in the Users section (T14740)', () => {
  let scrollIntoView;
  beforeEach(() => {
    tableUsers = [];
    scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    mockApiFetch.mockReset();
    mockApiFetch.mockImplementation(async url => ({
      ok: true,
      json: async () => {
        if (url.startsWith('/api/admin/dashboard')) return DASHBOARD;
        if (url.startsWith('/api/admin/analytics/journey')) return JOURNEY;
        if (url.startsWith('/api/admin/users?')) return USERS;
        return { cards: {}, days: 30 };
      },
    }));
    useAdminStore.setState({
      users: [], usersLoading: false, usersError: null, segmentOrigin: null, segmentFrom: null,
      segmentTo: null, segmentBuild: null, userFilter: null, excludeTest: true, journeyData: null,
      journeyUserFilter: null, dimension: 'campaigns',
    });
  });

  it('a count queries that stage and outcome, shows the chip and scrolls to Users', async () => {
    await mount();
    await clickGone();

    const p = lastUsersParams();
    expect(p.getAll('journey_stage')).toEqual(['signed_up']);
    expect(p.get('journey_outcome')).toBe('gone');
    expect(p.get('window_days')).toBe('14');
    expect(p.get('inactive_days')).toBe('14');
    expect(p.get('exclude_test')).toBe('true');
    expect(p.has('platform')).toBe(false);
    expect(chip().textContent).toContain('Stopped at Signed up: gone (6)');
    expect(scrollIntoView).toHaveBeenCalled();
  });

  it('the lost number uses the lost outcome', async () => {
    await mount();
    await act(async () => { fireEvent.click(screen.getByTestId('journey-loss-count-signed_up')); });
    await waitFor(() => expect(lastUsersParams().get('journey_outcome')).toBe('lost'));
    expect(chip().textContent).toContain('Stopped at Signed up: lost (6)');
  });

  it('a platform control travels with the filter', async () => {
    await mount();
    fireEvent.click(within(screen.getByRole('group', { name: 'Platform' })).getByText('desktop'));
    await clickGone();
    expect(lastUsersParams().get('platform')).toBe('desktop');
  });

  it('x clears the chip and refetches without the filter', async () => {
    await mount();
    await clickGone();
    await act(async () => { fireEvent.click(within(chip()).getByRole('button')); });
    expect(chip()).toBeNull();
    expect(lastUsersParams().has('journey_stage')).toBe(false);
  });

  it('a Journey control clears the chip', async () => {
    await mount();
    await clickGone();
    await act(async () => {
      fireEvent.click(within(screen.getByRole('group', { name: 'Inactive after' })).getByText('30d'));
    });
    expect(chip()).toBeNull();
    expect(lastUsersParams().has('journey_stage')).toBe(false);
  });

  it('pressing the Journey control already on keeps the chip', async () => {
    await mount();
    await clickGone();
    await act(async () => {
      fireEvent.click(within(screen.getByRole('group', { name: 'Inactive after' })).getByText('14d'));
    });
    expect(chip()).not.toBeNull();
  });

  it('a user filter pill clears the chip, and the chip clears the pill', async () => {
    await mount();
    await clickGone();
    await act(async () => { fireEvent.click(screen.getByText('Paying')); });
    expect(chip()).toBeNull();
    expect(lastUsersParams().get('filter')).toBe('paying');
    expect(lastUsersParams().has('journey_stage')).toBe(false);

    await clickGone();
    expect(useAdminStore.getState().userFilter).toBeNull();
    expect(lastUsersParams().has('filter')).toBe(false);
    expect(lastUsersParams().get('journey_outcome')).toBe('gone');
  });

  it('the Real pill and a campaign pick clear the chip, they change who the Journey counts', async () => {
    await mount();
    await clickGone();
    await act(async () => { fireEvent.click(screen.getByText('Real')); });
    expect(chip()).toBeNull();
    expect(lastUsersParams().has('journey_stage')).toBe(false);

    await clickGone();
    await act(async () => { fireEvent.click(screen.getByText('campaign-row')); });
    expect(chip()).toBeNull();
    expect(lastUsersParams().has('journey_stage')).toBe(false);
  });

  it('Clear all shows with the chip on and clears it', async () => {
    await mount();
    await clickGone();
    await act(async () => { fireEvent.click(screen.getByText('Clear all')); });
    expect(chip()).toBeNull();
  });

  it('opens a collapsed Users section so the list can be seen', async () => {
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Users' }));
    await waitFor(() => expect(screen.queryByTestId('user-table')).toBeNull());
    // A scroll before the section renders stops short: the page is too short to reach it.
    let tableAtScroll = null;
    scrollIntoView.mockImplementation(() => { tableAtScroll = screen.queryByTestId('user-table'); });
    await clickGone();
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
    expect(tableAtScroll).not.toBeNull();
    expect(chip()).not.toBeNull();
  });

  it('keeps a user with no email in the list, because the map counts them', async () => {
    const withBlank = { ...USERS, users: [{ user_id: 'a', email: 'a@x.com' }, { user_id: 'b', email: null }], total_users: 2 };
    mockApiFetch.mockImplementation(async url => ({
      ok: true,
      json: async () => {
        if (url.startsWith('/api/admin/dashboard')) return DASHBOARD;
        if (url.startsWith('/api/admin/analytics/journey')) return JOURNEY;
        if (url.startsWith('/api/admin/users?')) return withBlank;
        return { cards: {}, days: 30 };
      },
    }));
    await mount();
    await clickGone();
    await waitFor(() => expect(tableUsers.map(u => u.user_id)).toEqual(['a', 'b']));
  });

  it('a slow earlier response does not replace a newer list', async () => {
    await mount();
    let releaseSlow;
    const slow = new Promise(r => { releaseSlow = r; });
    mockApiFetch.mockImplementationOnce(async () => {
      await slow;
      return { ok: true, json: async () => ({ ...USERS, users: [{ user_id: 'old', email: 'old@x.com' }] }) };
    });
    await clickGone();
    await act(async () => { await useAdminStore.getState().fetchUsers(1); });
    await act(async () => { releaseSlow(); await slow; });
    expect(useAdminStore.getState().users.map(u => u.user_id)).toEqual(['a']);
  });

  it('is view state: a fresh store has no filter', () => {
    expect(useAdminStore.getInitialState().journeyUserFilter).toBeNull();
  });
});
