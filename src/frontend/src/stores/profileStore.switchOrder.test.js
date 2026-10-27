// T13630:C3 switching profiles clears the old profile's games BEFORE the new
// currentProfileId is published, so stale game tiles never request
// /api/games/{id}/poster.jpg?profile_id=<new profile> (404s for the old profile's games).
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../utils/sessionInit', () => ({ reinstallProfileHeader: vi.fn(), getProfileId: vi.fn() }));
vi.mock('../config', () => ({ API_BASE: '' }));
vi.mock('../services/ExportWebSocketManager', () => ({ default: { disconnectAll: vi.fn() } }));

const hoisted = vi.hoisted(() => ({ profileIdAtGamesReset: undefined, getProfileId: null }));
const store = (extra = {}) => ({
  getState: () => ({
    reset: vi.fn(), fetchProjects: vi.fn(), fetchGames: vi.fn(), fetchCredits: vi.fn(),
    fetchProgress: vi.fn(), setEditorMode: vi.fn(), ...extra,
  }),
});
vi.mock('./index', () => ({
  useProjectsStore: store(),
  useGamesDataStore: store({
    reset: () => { hoisted.profileIdAtGamesReset = hoisted.getProfileId(); },
  }),
  useProjectDataStore: store(), useFocusStore: store(), useOverlayStore: store(),
  useVideoStore: store(), useExportStore: store(), useUploadStore: store(),
  useGalleryStore: store(), useSettingsStore: store(), useCreditStore: store(),
  useQuestStore: store(), useIntroCardStore: store(), useEditorStore: store(),
  EDITOR_MODES: { PROJECT_MANAGER: 'project_manager' },
}));

global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({}) }));

describe('profileStore.switchProfile ordering (T13630)', () => {
  let useProfileStore;
  beforeEach(async () => {
    vi.resetModules();
    hoisted.profileIdAtGamesReset = undefined;
    ({ useProfileStore } = await import('./profileStore'));
    hoisted.getProfileId = () => useProfileStore.getState().currentProfileId;
    useProfileStore.setState({
      profiles: [{ id: 'a', isCurrent: true }, { id: 'b' }], currentProfileId: 'a',
    });
  });

  it('T13630:C3 games are reset while the OLD profile id is still current', async () => {
    await useProfileStore.getState().switchProfile('b');
    expect(useProfileStore.getState().currentProfileId).toBe('b');
    expect(hoisted.profileIdAtGamesReset).toBe('a');
  });
});
