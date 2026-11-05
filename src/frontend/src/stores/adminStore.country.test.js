// T15100: country is a standing segment filter. Every analytics loader sends it, and row
// picks compose with it instead of replacing it.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config', () => ({ API_BASE: '' }));
const apiFetch = vi.fn();
vi.mock('../utils/apiFetch', () => ({ default: (...a) => apiFetch(...a) }));
vi.mock('./creditStore', () => ({ useCreditStore: { getState: () => ({ fetchCredits: vi.fn() }) } }));

import { useAdminStore } from './adminStore';

const BODY = {
  users: [], page: 1, total_pages: 1, channels: [], cohorts: [], builds: [], countries: ['US', 'DE'],
};
const store = () => useAdminStore.getState();
const urls = () => apiFetch.mock.calls.map(c => c[0]);
const paramOf = (path, name) => {
  const url = urls().find(u => u.startsWith(path));
  expect(url, path).toBeTruthy();
  return new URLSearchParams(url.split('?')[1]).get(name);
};

describe('adminStore country filter', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    apiFetch.mockImplementation(async () => ({ ok: true, json: async () => BODY }));
    useAdminStore.setState({
      segmentOrigin: null, segmentFrom: null, segmentTo: null, segmentBuild: null, segmentCountry: 'DE',
      userFilter: null, channelsBy: 'origin', channelsData: null, cohortsData: null, buildsData: null,
      countries: [], excludeTest: true,
    });
  });

  it.each([
    ['fetchChannels', '/api/admin/analytics/channels'],
    ['fetchCohorts', '/api/admin/analytics/cohorts'],
    ['fetchBuilds', '/api/admin/analytics/builds'],
    ['fetchDashboard', '/api/admin/dashboard'],
  ])('%s sends the country', async (loader, path) => {
    await store()[loader]();
    expect(paramOf(path, 'country')).toBe('DE');
  });

  it.each([
    ['fetchChannels', '/api/admin/analytics/channels'],
    ['fetchCohorts', '/api/admin/analytics/cohorts'],
    ['fetchBuilds', '/api/admin/analytics/builds'],
  ])('%s sends none when no country is picked', async (loader, path) => {
    useAdminStore.setState({ segmentCountry: null });
    await store()[loader]();
    expect(paramOf(path, 'country')).toBeNull();
  });

  it('the Journey map and step inspector send the country from their filters', async () => {
    await store().fetchJourney({ country: 'unknown' });
    expect(paramOf('/api/admin/analytics/journey?', 'country')).toBe('unknown');
    await store().fetchJourneyStep('started', 'platform', { country: 'unknown' });
    expect(paramOf('/api/admin/analytics/journey/step/started', 'country')).toBe('unknown');
  });

  it('fetchCountries reads the window and ignores the picked country', async () => {
    useAdminStore.setState({ segmentFrom: '2026-10-05', segmentTo: '2026-10-11' });
    await store().fetchCountries();
    expect(paramOf('/api/admin/analytics/countries', 'from')).toBe('2026-10-05');
    expect(paramOf('/api/admin/analytics/countries', 'to')).toBe('2026-10-11');
    expect(paramOf('/api/admin/analytics/countries', 'country')).toBeNull();
    expect(store().countries).toEqual(['US', 'DE']);
  });

  it('the dashboard payload carries the first options', async () => {
    apiFetch.mockImplementation(async () => ({ ok: true, json: async () => ({
      users: BODY, pulse: {}, channels: BODY, cohorts: BODY, platforms: {}, countries: ['FR'],
    }) }));
    await store().fetchDashboard();
    expect(store().countries).toEqual(['FR']);
  });

  it('the options reload when the window or the Real pill changes, not on a pick', () => {
    const countriesCalls = () => urls().filter(u => u.startsWith('/api/admin/analytics/countries')).length;
    store().setSegmentFilter('abc123', null, null);
    expect(countriesCalls()).toBe(0);
    store().setSegmentFilter(null, '2026-10-05', '2026-10-11');
    expect(countriesCalls()).toBe(1);
    store().setExcludeTest(false);
    expect(countriesCalls()).toBe(2);
    store().setSegmentCountry('US');
    expect(countriesCalls()).toBe(2);
    store().clearSegmentFilter();
    expect(countriesCalls()).toBe(3);
  });

  it('picking a country reloads every loaded read', () => {
    useAdminStore.setState({ segmentCountry: null, buildsData: { builds: [] } });
    store().setSegmentCountry('US');
    expect(store().segmentCountry).toBe('US');
    for (const path of ['/api/admin/users?', '/api/admin/analytics/pulse?', '/api/admin/analytics/channels?',
      '/api/admin/analytics/cohorts?', '/api/admin/analytics/builds?']) {
      expect(paramOf(path, 'country')).toBe('US');
    }
  });

  it('a builds table never opened stays unloaded until its pill is clicked', () => {
    store().setSegmentCountry('US');
    expect(urls().some(u => u.startsWith('/api/admin/analytics/builds'))).toBe(false);
  });

  it('a row pick keeps the country', () => {
    store().setSegmentFilter('abc123', null, null);
    expect(store().segmentOrigin).toBe('abc123');
    expect(store().segmentCountry).toBe('DE');
    expect(paramOf('/api/admin/users?', 'country')).toBe('DE');
  });

  it('Clear all drops the country and reloads the tables it narrowed', () => {
    useAdminStore.setState({ buildsData: { builds: [] } });
    store().clearSegmentFilter();
    expect(store().segmentCountry).toBeNull();
    for (const path of ['/api/admin/analytics/channels', '/api/admin/analytics/cohorts', '/api/admin/analytics/builds']) {
      expect(paramOf(path, 'country')).toBeNull();
    }
  });

  it('Clear all with no country leaves the tables alone', () => {
    useAdminStore.setState({ segmentCountry: null });
    store().clearSegmentFilter();
    expect(urls().some(u => u.startsWith('/api/admin/analytics/cohorts'))).toBe(false);
  });

  it('a superseded cohorts or builds response is dropped', async () => {
    for (const [loader, key, field] of [['fetchCohorts', 'cohortsData', 'cohorts'], ['fetchBuilds', 'buildsData', 'builds']]) {
      let releaseOld;
      apiFetch.mockImplementationOnce(() => new Promise(resolve => { releaseOld = resolve; }));
      const old = store()[loader]();
      apiFetch.mockImplementationOnce(async () => ({ ok: true, json: async () => ({ [field]: ['new'] }) }));
      await store()[loader]();
      releaseOld({ ok: true, json: async () => ({ [field]: ['old'] }) });
      await old;
      expect(store()[key][field]).toEqual(['new']);
    }
  });
});
