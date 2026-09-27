import { describe, it, expect, vi } from 'vitest';

vi.mock('../config', () => ({ API_BASE: '' }));
vi.mock('../utils/apiFetch', () => ({ default: vi.fn() }));

/**
 * T11240 C7 (T11210 pattern): a project is now exactly one clip, so
 * projectDataStore's multi-clip management surface (add/delete/reorder/upload/
 * transition/selected-index) is dead. On unchanged master these are all still
 * exposed, so every assertion below fails there; C7 deletes them.
 */
describe('T11240 multi-clip store surface removed', () => {
  it('projectDataStore no longer exposes globalTransition or setGlobalTransition', async () => {
    const { useProjectDataStore } = await import('./projectDataStore');
    const state = useProjectDataStore.getState();
    expect(state.globalTransition).toBeUndefined();
    expect(state.setGlobalTransition).toBeUndefined();
  });

  it('projectDataStore no longer exposes addClip / deleteClip / reorderClips', async () => {
    const { useProjectDataStore } = await import('./projectDataStore');
    const state = useProjectDataStore.getState();
    expect(state.addClip).toBeUndefined();
    expect(state.deleteClip).toBeUndefined();
    expect(state.reorderClips).toBeUndefined();
  });

  it('projectDataStore no longer exposes addClipFromLibrary / uploadClipWithMetadata / removeClip', async () => {
    const { useProjectDataStore } = await import('./projectDataStore');
    const state = useProjectDataStore.getState();
    expect(state.addClipFromLibrary).toBeUndefined();
    expect(state.uploadClipWithMetadata).toBeUndefined();
    expect(state.removeClip).toBeUndefined();
  });

  it('projectDataStore no longer exposes getSelectedClipIndex', async () => {
    const { useProjectDataStore } = await import('./projectDataStore');
    expect(useProjectDataStore.getState().getSelectedClipIndex).toBeUndefined();
  });

  it('stores/index.js no longer exports useGlobalTransition', async () => {
    const storesIndex = await import('./index');
    expect(storesIndex.useGlobalTransition).toBeUndefined();
  });
});
