// T7400: admin-panel control for the action/engagement rollup sweep (POST
// /api/admin/analytics/rollup), mirroring runJourneyRollup's (adminStore.js) shape.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config', () => ({ API_BASE: '' }));
const apiFetch = vi.fn();
vi.mock('../utils/apiFetch', () => ({ default: (...a) => apiFetch(...a) }));
vi.mock('./creditStore', () => ({ useCreditStore: { getState: () => ({ fetchCredits: vi.fn() }) } }));

import { useAdminStore } from './adminStore';

const store = () => useAdminStore.getState();

describe('adminStore runActionRollup (T7400)', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    useAdminStore.setState({ actionRollup: { running: false, error: null, result: null } });
  });

  it('POSTs the rollup endpoint and stores users_swept/users_failed/computed_at on success', async () => {
    const body = { run_id: 'r1', computed_at: '2026-11-09T00:00:00+00:00', users_swept: 12, users_failed: 1, log_rows_reduced: 40 };
    apiFetch.mockResolvedValue({ ok: true, json: async () => body });

    const result = await store().runActionRollup();

    expect(apiFetch).toHaveBeenCalledWith('/api/admin/analytics/rollup', { method: 'POST' });
    expect(result).toEqual(body);
    expect(store().actionRollup).toEqual({ running: false, error: null, result: body });
  });

  it('records the error on failure without throwing', async () => {
    apiFetch.mockResolvedValue({ ok: false, status: 503 });

    const result = await store().runActionRollup();

    expect(result).toBeNull();
    expect(store().actionRollup.running).toBe(false);
    expect(store().actionRollup.error).toMatch(/503/);
  });
});
