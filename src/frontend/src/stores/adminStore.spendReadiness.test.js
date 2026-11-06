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

// A promise the test resolves by hand, to order two in-flight responses.
function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}

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

  // Review follow-up 2026-11-06: the Diagnose cache must follow the panel payload (Refresh, the
  // Real pill) and never let an older response land on top of a newer one.
  it('fetchSpendReadiness clears the diagnosis cache so an open drawer refetches against the new numbers', async () => {
    useAdminStore.setState({ spendGateDiagnosis: { upload_failure: { loading: false, error: null, data: { cuts: {} } } } });
    mockApiFetch.mockResolvedValue({ ok: true, json: async () => PAYLOAD });
    await useAdminStore.getState().fetchSpendReadiness();
    expect(useAdminStore.getState().spendGateDiagnosis).toEqual({});
    expect(useAdminStore.getState().spendReadiness).toEqual(PAYLOAD);
  });

  it('an older diagnosis response never overwrites a newer one', async () => {
    const first = deferred();
    const second = deferred();
    mockApiFetch.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const p1 = useAdminStore.getState().fetchSpendGateDiagnosis('upload_failure');
    const p2 = useAdminStore.getState().fetchSpendGateDiagnosis('upload_failure');
    second.resolve({ ok: true, json: async () => ({ key: 'upload_failure', cuts: { weekly: ['new'] } }) });
    await p2;
    first.resolve({ ok: true, json: async () => ({ key: 'upload_failure', cuts: { weekly: ['old'] } }) });
    await p1;
    expect(useAdminStore.getState().spendGateDiagnosis.upload_failure.data.cuts.weekly).toEqual(['new']);
    expect(useAdminStore.getState().spendGateDiagnosis.upload_failure.loading).toBe(false);
  });

  it('a diagnosis response that lands after a refetch cleared the cache is dropped', async () => {
    const slow = deferred();
    mockApiFetch.mockReturnValueOnce(slow.promise);
    const p = useAdminStore.getState().fetchSpendGateDiagnosis('upload_failure');
    mockApiFetch.mockResolvedValue({ ok: true, json: async () => PAYLOAD });
    await useAdminStore.getState().fetchSpendReadiness();
    slow.resolve({ ok: true, json: async () => ({ key: 'upload_failure', cuts: { weekly: ['stale'] } }) });
    await p;
    expect(useAdminStore.getState().spendGateDiagnosis).toEqual({});
  });

  it('an older spend-readiness response never overwrites a newer one', async () => {
    const first = deferred();
    const second = deferred();
    mockApiFetch.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const p1 = useAdminStore.getState().fetchSpendReadiness();
    const p2 = useAdminStore.getState().fetchSpendReadiness();
    second.resolve({ ok: true, json: async () => ({ ...PAYLOAD, computed_at: 'new' }) });
    await p2;
    first.resolve({ ok: true, json: async () => ({ ...PAYLOAD, computed_at: 'old' }) });
    await p1;
    expect(useAdminStore.getState().spendReadiness.computed_at).toBe('new');
    expect(useAdminStore.getState().spendReadinessLoading).toBe(false);
  });
});
