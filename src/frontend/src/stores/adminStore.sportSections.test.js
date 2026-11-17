// T16850: the Sport filter at the top of Admin reaches every section that counts people.
// Each section's read sends `sport` when one is picked and none for "All sports"; a sport
// change reloads the sections already on screen.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config', () => ({ API_BASE: '' }));
const apiFetch = vi.fn();
vi.mock('../utils/apiFetch', () => ({ default: (...a) => apiFetch(...a) }));
vi.mock('./creditStore', () => ({ useCreditStore: { getState: () => ({ fetchCredits: vi.fn() }) } }));

import { useAdminStore } from './adminStore';

const store = () => useAdminStore.getState();
const urls = () => apiFetch.mock.calls.map(c => c[0]);
const sportOf = (prefix) => {
  const url = urls().find(u => u.startsWith(prefix));
  expect(url, `no request to ${prefix}`).toBeTruthy();
  return new URLSearchParams(url.split('?')[1]).get('sport');
};

const SECTIONS = [
  ['pulse', () => store().fetchPulse(), '/api/admin/analytics/pulse'],
  ['platforms', () => store().fetchPlatforms(), '/api/admin/analytics/platforms'],
  ['pack mix', () => store().fetchPackMix(), '/api/admin/analytics/pack-mix'],
  ['retention', () => store().fetchRetentionChart(), '/api/admin/analytics/retention-chart'],
  ['activation', () => store().fetchActivation(), '/api/admin/analytics/activation'],
  ['revenue reconciliation', () => store().fetchReconciliation(), '/api/admin/revenue-reconciliation'],
  ['upload failures', () => store().fetchUploadFailures(), '/api/admin/upload-failures'],
  ['dashboard', () => store().fetchDashboard(), '/api/admin/dashboard'],
];

describe('adminStore Sport filter over every section', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    apiFetch.mockImplementation(async () => ({ ok: true, json: async () => ({}) }));
    useAdminStore.setState({
      segmentOrigin: null, segmentFrom: null, segmentTo: null, segmentBuild: null,
      segmentCountry: null, segmentSport: null, userFilter: null, journeyUserFilter: null,
      excludeTest: true, packMixData: null, retentionChartData: null, activationData: null,
      uploadFailuresData: null, reconciliationData: null,
    });
  });

  it.each(SECTIONS)('%s sends the picked sport', async (_name, fetch, prefix) => {
    useAdminStore.setState({ segmentSport: 'hockey' });
    await fetch();
    expect(sportOf(prefix)).toBe('hockey');
  });

  it.each(SECTIONS)('%s sends no sport for All sports', async (_name, fetch, prefix) => {
    await fetch();
    expect(sportOf(prefix)).toBeNull();
  });

  it('the heal gesture heals the report for the picked sport', async () => {
    useAdminStore.setState({ segmentSport: 'lacrosse' });
    await store().healReconciliation({ allDrifted: true });
    const heal = apiFetch.mock.calls.find(c => c[0].endsWith('/revenue-reconciliation/heal'));
    expect(JSON.parse(heal[1].body).sport).toBe('lacrosse');
  });

  it('a sport pick reloads pulse, platforms and every section already loaded', async () => {
    useAdminStore.setState({ packMixData: {}, retentionChartData: {}, activationData: {}, uploadFailuresData: {} });
    store().setSegmentSport('hockey');
    await Promise.resolve();
    for (const prefix of ['/api/admin/users', '/api/admin/analytics/pulse', '/api/admin/analytics/platforms',
      '/api/admin/analytics/pack-mix', '/api/admin/analytics/retention-chart',
      '/api/admin/analytics/activation', '/api/admin/upload-failures']) {
      expect(sportOf(prefix)).toBe('hockey');
    }
  });

  it('a sport pick leaves unopened sections unloaded and drops a stale Stripe report', async () => {
    useAdminStore.setState({ reconciliationData: { rows: [] } });
    store().setSegmentSport('hockey');
    await Promise.resolve();
    expect(urls().some(u => u.startsWith('/api/admin/analytics/pack-mix'))).toBe(false);
    expect(urls().some(u => u.startsWith('/api/admin/revenue-reconciliation'))).toBe(false);
    expect(store().reconciliationData).toBeNull();
  });

  it('Clear all with a sport picked reloads the loaded sections without it', async () => {
    useAdminStore.setState({ segmentSport: 'hockey', packMixData: {} });
    store().clearSegmentFilter();
    await Promise.resolve();
    expect(sportOf('/api/admin/analytics/platforms')).toBeNull();
    expect(sportOf('/api/admin/analytics/pack-mix')).toBeNull();
  });
});
