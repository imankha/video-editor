import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock config + apiFetch before importing the store (the T10270 pattern).
vi.mock('../config', () => ({ API_BASE: '' }));

const mockApiFetch = vi.fn();
vi.mock('../utils/apiFetch', () => ({ default: (...args) => mockApiFetch(...args) }));

vi.mock('./creditStore', () => ({
  useCreditStore: { getState: () => ({ fetchCredits: vi.fn() }) },
}));

import { useAdminStore } from './adminStore';

const PAYLOAD = { computed_at: '2026-11-05T19:12:00+00:00', gates: [], channels: [], verdict: { headline: 'x', line: '', all_green: false } };

describe('adminStore spend readiness (T14910)', () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
    useAdminStore.setState({
      spendReadiness: null, spendReadinessLoading: false, spendReadinessError: null,
      spendGateDiagnosis: {}, excludeTest: true,
    });
  });

  it('fetchSpendReadiness reads the endpoint with the Real pill and stores the payload', async () => {
    mockApiFetch.mockResolvedValue({ ok: true, json: async () => PAYLOAD });
    await useAdminStore.getState().fetchSpendReadiness();
    expect(mockApiFetch).toHaveBeenCalledWith('/api/admin/analytics/spend-readiness?exclude_test=true');
    expect(useAdminStore.getState().spendReadiness).toEqual(PAYLOAD);
    expect(useAdminStore.getState().spendReadinessLoading).toBe(false);
    expect(useAdminStore.getState().spendReadinessError).toBeNull();
  });

  it('fetchSpendReadiness follows excludeTest=false and records an HTTP error', async () => {
    useAdminStore.setState({ excludeTest: false });
    mockApiFetch.mockResolvedValue({ ok: false, status: 500 });
    await useAdminStore.getState().fetchSpendReadiness();
    expect(mockApiFetch).toHaveBeenCalledWith('/api/admin/analytics/spend-readiness?exclude_test=false');
    expect(useAdminStore.getState().spendReadiness).toBeNull();
    expect(useAdminStore.getState().spendReadinessError).toBe('HTTP 500');
  });

  it('fetchSpendGateDiagnosis keeps one entry per gate and never touches the panel payload', async () => {
    useAdminStore.setState({ spendReadiness: PAYLOAD });
    const cuts = { key: 'upload_failure', tier: 'B', cuts: { weekly: [] } };
    mockApiFetch.mockResolvedValue({ ok: true, json: async () => cuts });
    await useAdminStore.getState().fetchSpendGateDiagnosis('upload_failure');
    expect(mockApiFetch).toHaveBeenCalledWith('/api/admin/analytics/spend-readiness/gate/upload_failure?exclude_test=true');
    expect(useAdminStore.getState().spendGateDiagnosis.upload_failure).toEqual({ loading: false, error: null, data: cuts });
    expect(useAdminStore.getState().spendReadiness).toEqual(PAYLOAD);

    mockApiFetch.mockResolvedValue({ ok: false, status: 404 });
    await useAdminStore.getState().fetchSpendGateDiagnosis('nope');
    expect(useAdminStore.getState().spendGateDiagnosis.nope).toEqual({ loading: false, error: 'HTTP 404', data: null });
    expect(useAdminStore.getState().spendGateDiagnosis.upload_failure.data).toEqual(cuts);
  });
});
