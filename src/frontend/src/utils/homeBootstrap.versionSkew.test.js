import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runHomeBootstrap } from './homeBootstrap';

// T11180:C2 - quests are gone from the app, but a server that still sends
// quest fields (or one that already dropped them) must both boot Home: the
// bootstrap reads no quest field and needs no quest store.

function makeStores() {
  const store = () => ({
    setFromBootstrap: vi.fn(),
    fetchProfiles: vi.fn().mockResolvedValue(),
    loadSettings: vi.fn().mockResolvedValue(),
    fetchProjects: vi.fn().mockResolvedValue(),
    fetchGames: vi.fn().mockResolvedValue(),
    fetchCount: vi.fn().mockResolvedValue(),
  });
  const names = ['useProfileStore', 'useSettingsStore', 'useCreditStore', 'useProjectsStore',
    'useGamesDataStore', 'useGalleryStore', 'useConfigStore'];
  const raw = Object.fromEntries(names.map((n) => [n, store()]));
  const stores = Object.fromEntries(names.map((n) => [n, { getState: () => raw[n] }]));
  return { raw, stores };
}

const BASE = { profiles: [], settings: {}, credits: 0, projects: [], games: [], downloads: [], upload_limits: {} };

describe('T11180 bootstrap version skew', () => {
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  for (const [label, body] of [
    ['with quest fields', { ...BASE, quests_progress: [], quest_panel_collapsed: true }],
    ['without quest fields', BASE],
  ]) {
    it(`boots Home from a bootstrap ${label}`, async () => {
      const { raw, stores } = makeStores();
      const apiFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => body });
      await runHomeBootstrap({ apiFetch, API_BASE: '', stores });
      expect(console.error).not.toHaveBeenCalled();
      expect(raw.useProjectsStore.setFromBootstrap).toHaveBeenCalledWith([]);
      expect(raw.useGalleryStore.setFromBootstrap).toHaveBeenCalledWith([]);
      expect(raw.useConfigStore.setFromBootstrap).toHaveBeenCalledWith({});
      expect(raw.useProjectsStore.fetchProjects).not.toHaveBeenCalled();
    });
  }
});
