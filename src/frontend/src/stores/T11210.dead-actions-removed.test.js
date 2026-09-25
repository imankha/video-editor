import { describe, it, expect, vi } from 'vitest';

vi.mock('../config', () => ({ API_BASE: '' }));
vi.mock('../utils/apiFetch', () => ({ default: vi.fn() }));

/**
 * T11210: createProject (projectsStore) and reorderClipsOnServer
 * (projectDataStore) backed the deleted POST /api/projects (bare create)
 * and dead reorder-on-server path. On unchanged master both actions are
 * still exposed by their stores, so these assertions fail there; after the
 * T11210 deletion commit the stores no longer expose them.
 */
describe('T11210 dead store actions removed', () => {
  it('projectsStore no longer exposes createProject', async () => {
    const { useProjectsStore } = await import('./projectsStore');
    expect(useProjectsStore.getState().createProject).toBeUndefined();
  });

  it('projectDataStore no longer exposes reorderClipsOnServer', async () => {
    const { useProjectDataStore } = await import('./projectDataStore');
    expect(useProjectDataStore.getState().reorderClipsOnServer).toBeUndefined();
  });
});
