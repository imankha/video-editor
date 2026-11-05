import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock config + apiFetch before importing the store (the T10270 pattern). The roadmap is a
// static file of the frontend build, not an API resource, so it goes through plain fetch.
vi.mock('../config', () => ({ API_BASE: '' }));
const mockApiFetch = vi.fn();
vi.mock('../utils/apiFetch', () => ({ default: (...args) => mockApiFetch(...args) }));
vi.mock('./creditStore', () => ({
  useCreditStore: { getState: () => ({ fetchCredits: vi.fn() }) },
}));

import { useAdminStore } from './adminStore';

const ROADMAP = { generated_at: '2026-11-05T22:10:00Z', commit: '51f1f0db9', transitions: {}, gates: {}, tasks: {} };

describe('adminStore roadmap (T14920:C4)', () => {
  const realFetch = globalThis.fetch;
  let mockFetch;
  beforeEach(() => {
    mockFetch = vi.fn();
    globalThis.fetch = mockFetch;
    mockApiFetch.mockReset();
    useAdminStore.setState({ roadmap: null, roadmapLoading: false, roadmapError: null });
  });
  afterEach(() => { globalThis.fetch = realFetch; });

  it('starts empty and exposes fetchRoadmap', () => {
    const s = useAdminStore.getState();
    expect(s.roadmap).toBeNull();
    expect(s.roadmapError).toBeNull();
    expect(typeof s.fetchRoadmap).toBe('function');
  });

  it('fetchRoadmap reads /roadmap.json uncached through plain fetch and stores the payload raw', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ROADMAP });
    await useAdminStore.getState().fetchRoadmap();
    expect(mockFetch).toHaveBeenCalledWith('/roadmap.json', { cache: 'no-store' });
    expect(mockApiFetch).not.toHaveBeenCalled();
    expect(useAdminStore.getState().roadmap).toEqual(ROADMAP);
    expect(useAdminStore.getState().roadmapLoading).toBe(false);
    expect(useAdminStore.getState().roadmapError).toBeNull();
  });

  it('a missing export leaves roadmap null and records the error', async () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockFetch.mockResolvedValue({ ok: false, status: 404 });
    await useAdminStore.getState().fetchRoadmap();
    expect(useAdminStore.getState().roadmap).toBeNull();
    expect(useAdminStore.getState().roadmapError).toBe('HTTP 404');
    expect(useAdminStore.getState().roadmapLoading).toBe(false);
    warn.mockRestore();
  });

  it('an unparsable export is an error too, never a silent empty roadmap', async () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockFetch.mockResolvedValue({ ok: true, json: async () => { throw new SyntaxError('Unexpected token <'); } });
    await useAdminStore.getState().fetchRoadmap();
    expect(useAdminStore.getState().roadmap).toBeNull();
    expect(useAdminStore.getState().roadmapError).toContain('Unexpected token');
    warn.mockRestore();
  });
});
