import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock config + apiFetch before importing the store (T10270).
vi.mock('../config', () => ({ API_BASE: '' }));

const mockApiFetch = vi.fn();
vi.mock('../utils/apiFetch', () => ({ default: (...args) => mockApiFetch(...args) }));

// creditStore is imported by adminStore; stub its fetchCredits so nothing hits network.
vi.mock('./creditStore', () => ({
  useCreditStore: { getState: () => ({ fetchCredits: vi.fn() }) },
}));

import { useAdminStore } from './adminStore';

const RESPONSE = {
  window: { since_build: 4812, commit_sha: 'abc1234', since_date: '2026-09-16',
            until_date: '2026-09-17', rows_at_this_build: 2 },
  rows: [{ id: 1, kind: 'game', stage: 'preparing', reason: 'refused' }],
  total: 1,
  rates: {
    game: { attempts: 5, succeeded: 4, failed: 1, rate_pct: 80.0 },
    clip: { attempts: 0, succeeded: 0, failed: 0, rate_pct: null,
            denominator_note: 'outcome-based: clip_upload_attempted is not emitted yet (T8380)' },
  },
};

describe('adminStore upload failures (T10270)', () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
    useAdminStore.setState({
      uploadFailuresData: null, uploadFailuresLoading: false, uploadFailuresError: null,
    });
  });

  it('fetchUploadFailures stores the response with no params on a bare call', async () => {
    mockApiFetch.mockResolvedValue({ ok: true, json: async () => RESPONSE });
    await useAdminStore.getState().fetchUploadFailures();

    expect(mockApiFetch).toHaveBeenCalledWith('/api/admin/upload-failures?');
    expect(useAdminStore.getState().uploadFailuresData).toEqual(RESPONSE);
    expect(useAdminStore.getState().uploadFailuresLoading).toBe(false);
  });

  it('threads filters into query params with snake_case keys', async () => {
    mockApiFetch.mockResolvedValue({ ok: true, json: async () => RESPONSE });
    await useAdminStore.getState().fetchUploadFailures({
      kind: 'clip', stage: 'batching', includeImpersonated: true,
    });

    const [url] = mockApiFetch.mock.calls[0];
    const params = new URLSearchParams(url.split('?')[1]);
    expect(params.get('kind')).toBe('clip');
    expect(params.get('stage')).toBe('batching');
    expect(params.get('include_impersonated')).toBe('true');
  });

  it('records an error and stops loading on failure', async () => {
    mockApiFetch.mockResolvedValue({ ok: false, status: 403, json: async () => ({ detail: 'Admin access required' }) });
    await useAdminStore.getState().fetchUploadFailures();

    expect(useAdminStore.getState().uploadFailuresError).toBe('Admin access required');
    expect(useAdminStore.getState().uploadFailuresLoading).toBe(false);
    expect(useAdminStore.getState().uploadFailuresData).toBeNull();
  });

  it('stores a {migrated: false} response verbatim rather than treating it as an error', async () => {
    mockApiFetch.mockResolvedValue({ ok: true, json: async () => ({ migrated: false }) });
    await useAdminStore.getState().fetchUploadFailures();

    expect(useAdminStore.getState().uploadFailuresData).toEqual({ migrated: false });
    expect(useAdminStore.getState().uploadFailuresError).toBeNull();
  });
});
