import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runHomeBootstrap } from './homeBootstrap';

// T16050:C1 - Home's bootstrap (App.jsx's single `/api/bootstrap` call, fired
// once a session's profile is ready) wires the [LOAD] trace
// (src/utils/loadTrace.js). Factored into runHomeBootstrap so this is
// testable without mounting the whole App tree.

function makeStores() {
  const store = () => ({
    setFromBootstrap: vi.fn(),
    setPanelCollapsed: vi.fn(),
    fetchProfiles: vi.fn().mockResolvedValue(),
    loadSettings: vi.fn().mockResolvedValue(),
    fetchProjects: vi.fn().mockResolvedValue(),
    fetchGames: vi.fn().mockResolvedValue(),
    fetchProgress: vi.fn().mockResolvedValue(),
    fetchCount: vi.fn().mockResolvedValue(),
  });
  const wrap = (s) => ({ getState: () => s });
  const useProfileStore = store();
  const useSettingsStore = store();
  const useCreditStore = store();
  const useProjectsStore = store();
  const useGamesDataStore = store();
  const useQuestStore = store();
  const useGalleryStore = store();
  const useConfigStore = store();
  return {
    raw: { useProfileStore, useSettingsStore, useCreditStore, useProjectsStore, useGamesDataStore, useQuestStore, useGalleryStore, useConfigStore },
    stores: {
      useProfileStore: wrap(useProfileStore),
      useSettingsStore: wrap(useSettingsStore),
      useCreditStore: wrap(useCreditStore),
      useProjectsStore: wrap(useProjectsStore),
      useGamesDataStore: wrap(useGamesDataStore),
      useQuestStore: wrap(useQuestStore),
      useGalleryStore: wrap(useGalleryStore),
      useConfigStore: wrap(useConfigStore),
    },
  };
}

function infoLines() {
  return console.info.mock.calls.map((args) => args.join(' '));
}

describe('T16050 runHomeBootstrap [LOAD] trace wiring', () => {
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    delete window.__bootstrapExports;
    window.__bootstrapLoaded = false;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('T16050:C1 logs a waiting-for line, then an arrived+settled line on a successful bootstrap', async () => {
    const { stores, raw } = makeStores();
    const apiFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ profiles: [], settings: {}, credits: 0, projects: [], games: [], quests_progress: {}, downloads: [] }),
    });

    await runHomeBootstrap({ apiFetch, API_BASE: 'http://x', stores });

    expect(infoLines().some((l) => l.includes('[LOAD] Home waiting for bootstrap'))).toBe(true);
    expect(infoLines().some((l) => l.includes('[LOAD] Home bootstrap arrived'))).toBe(true);
    expect(infoLines().some((l) => l.includes('[LOAD] Home settled in'))).toBe(true);
    expect(raw.useProjectsStore.setFromBootstrap).toHaveBeenCalled();
    expect(raw.useProjectsStore.fetchProjects).not.toHaveBeenCalled();
  });

  it('logs bootstrap failed and falls back to individual fetches when the request throws', async () => {
    const { stores, raw } = makeStores();
    const apiFetch = vi.fn().mockRejectedValue(new Error('network down'));

    await runHomeBootstrap({ apiFetch, API_BASE: 'http://x', stores });

    expect(infoLines().some((l) => l.includes('[LOAD] Home bootstrap failed'))).toBe(true);
    expect(infoLines().some((l) => l.includes('[LOAD] Home settled in'))).toBe(true);
    expect(raw.useProjectsStore.fetchProjects).toHaveBeenCalledWith({ reason: 'bootstrap' });
  });

  it('logs bootstrap failed when the response is not ok', async () => {
    const { stores } = makeStores();
    const apiFetch = vi.fn().mockResolvedValue({ ok: false, status: 503 });

    await runHomeBootstrap({ apiFetch, API_BASE: 'http://x', stores });

    expect(infoLines().some((l) => l.includes('[LOAD] Home bootstrap failed'))).toBe(true);
  });
});
