// T7430 (ruling 2026-11-13): the Retention chart's grouping follows the dashboard's
// Dimension pill -- the fetch sends it as `group`, and a pill click re-fetches a
// chart that is already on screen (never fetches one the admin has not asked for).
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config', () => ({ API_BASE: '' }));
const apiFetch = vi.fn();
vi.mock('../utils/apiFetch', () => ({ default: (...a) => apiFetch(...a) }));
vi.mock('./creditStore', () => ({ useCreditStore: { getState: () => ({ fetchCredits: vi.fn() }) } }));

import { useAdminStore } from './adminStore';

const store = () => useAdminStore.getState();
const chartCalls = () => apiFetch.mock.calls.map((c) => c[0]).filter((u) => u.includes('/analytics/retention-chart'));

describe('adminStore retention chart grouping (T7430 C6)', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    apiFetch.mockResolvedValue({ ok: true, json: async () => ({ triangle: { cohorts: [] } }) });
    useAdminStore.setState({
      dimension: 'campaigns', retentionChartBin: 'week', retentionChartData: null, retentionChartLoading: false, retentionChartAction: '',
      channelsData: {}, cohortsData: {}, buildsData: {},
    });
  });

  it('sends the selected Dimension pill as the chart group', async () => {
    useAdminStore.setState({ dimension: 'builds' });
    await store().fetchRetentionChart();
    expect(chartCalls()).toHaveLength(1);
    expect(new URL(chartCalls()[0], 'http://x').searchParams.get('group')).toBe('builds');
  });

  it('re-fetches a loaded chart with the new group when the pill changes', async () => {
    useAdminStore.setState({ retentionChartData: { triangle: { cohorts: [] } } });
    store().setDimension('cohorts');
    await vi.waitFor(() => expect(chartCalls()).toHaveLength(1));
    expect(new URL(chartCalls()[0], 'http://x').searchParams.get('group')).toBe('cohorts');
  });

  it('does not fetch a chart nobody loaded when the pill changes', () => {
    store().setDimension('builds');
    expect(chartCalls()).toHaveLength(0);
  });

  // Amended C1: the weekly/monthly toggle bins the Cohorts grouping.
  it('sends the cohort bin and re-fetches a loaded chart when it changes', async () => {
    useAdminStore.setState({ dimension: 'cohorts', retentionChartData: { triangle: { cohorts: [] } } });
    store().setRetentionChartBin('month');
    await vi.waitFor(() => expect(chartCalls()).toHaveLength(1));
    expect(new URL(chartCalls()[0], 'http://x').searchParams.get('cohort_bin')).toBe('month');
    expect(store().retentionChartBin).toBe('month');
  });
});
