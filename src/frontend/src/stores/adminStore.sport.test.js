// T14930: arrival sport (landing page) is a standing segment filter on the users list,
// same shape as country ([[adminStore.country.test.js]]).
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config', () => ({ API_BASE: '' }));
const apiFetch = vi.fn();
vi.mock('../utils/apiFetch', () => ({ default: (...a) => apiFetch(...a) }));
vi.mock('./creditStore', () => ({ useCreditStore: { getState: () => ({ fetchCredits: vi.fn() }) } }));

import { useAdminStore } from './adminStore';

const BODY = { users: [], page: 1, total_pages: 1, total_users: 0, page_size: 10 };
const store = () => useAdminStore.getState();
const paramOf = (name) => {
  const url = apiFetch.mock.calls.map(c => c[0]).find(u => u.startsWith('/api/admin/users'));
  expect(url).toBeTruthy();
  return new URLSearchParams(url.split('?')[1]).get(name);
};

describe('adminStore arrival sport filter', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    apiFetch.mockImplementation(async () => ({ ok: true, json: async () => BODY }));
    useAdminStore.setState({
      segmentOrigin: null, segmentFrom: null, segmentTo: null, segmentBuild: null,
      segmentCountry: null, segmentSport: null, userFilter: null, journeyUserFilter: null,
      excludeTest: true,
    });
  });

  it('fetchUsers sends the picked sport', async () => {
    useAdminStore.setState({ segmentSport: 'hockey' });
    await store().fetchUsers(1);
    expect(paramOf('sport')).toBe('hockey');
  });

  it('fetchUsers sends none when no sport is picked', async () => {
    await store().fetchUsers(1);
    expect(paramOf('sport')).toBeNull();
  });

  it('setSegmentSport stores the pick and refetches users', async () => {
    store().setSegmentSport('unknown');
    expect(store().segmentSport).toBe('unknown');
    await Promise.resolve();
    expect(paramOf('sport')).toBe('unknown');
  });

  it('clearSegmentFilter drops the sport pick', async () => {
    useAdminStore.setState({ segmentSport: 'hockey' });
    await store().clearSegmentFilter();
    expect(store().segmentSport).toBeNull();
  });
});
