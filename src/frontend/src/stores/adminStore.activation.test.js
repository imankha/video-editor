// T7420 (ruling 2026-11-13): the Activation report's grouping follows the dashboard's
// Dimension pill -- the fetch sends it as `group`, and a pill click re-fetches a
// report that is already on screen (never fetches one the admin has not asked for).
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config', () => ({ API_BASE: '' }));
const apiFetch = vi.fn();
vi.mock('../utils/apiFetch', () => ({ default: (...a) => apiFetch(...a) }));
vi.mock('./creditStore', () => ({ useCreditStore: { getState: () => ({ fetchCredits: vi.fn() }) } }));

import { useAdminStore } from './adminStore';

const store = () => useAdminStore.getState();
const activationCalls = () => apiFetch.mock.calls.map((c) => c[0]).filter((u) => u.includes('/analytics/activation'));
const groupOf = (url) => new URL(url, 'http://x').searchParams.get('group');

describe('adminStore activation grouping (T7420 C5)', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    apiFetch.mockResolvedValue({ ok: true, json: async () => ({ group: 'cohorts', cohorts: [] }) });
    useAdminStore.setState({
      dimension: 'campaigns', activationData: null, activationLoading: false, retentionChartData: null,
      channelsData: {}, cohortsData: {}, buildsData: {},
    });
  });

  it('sends the selected Dimension pill as the report group', async () => {
    useAdminStore.setState({ dimension: 'builds' });
    await store().fetchActivation();
    expect(activationCalls()).toHaveLength(1);
    expect(groupOf(activationCalls()[0])).toBe('builds');
  });

  it('re-fetches a loaded report with the new group when the pill changes', async () => {
    useAdminStore.setState({ activationData: { group: 'campaigns', cohorts: [] } });
    store().setDimension('cohorts');
    await vi.waitFor(() => expect(activationCalls()).toHaveLength(1));
    expect(groupOf(activationCalls()[0])).toBe('cohorts');
  });

  it('does not fetch a report nobody loaded when the pill changes', () => {
    store().setDimension('builds');
    expect(activationCalls()).toHaveLength(0);
  });
});
