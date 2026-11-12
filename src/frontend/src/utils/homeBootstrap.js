import { startLoadTrace } from './loadTrace';

/**
 * T16050: the single `/api/bootstrap` call App.jsx fires once a session's
 * profile is ready (Home's cold-load data fetch). Factored out of App.jsx so
 * the [LOAD] trace wiring around it (and the fallback path on failure) is
 * unit-testable without mounting the whole App tree.
 */
export async function runHomeBootstrap({ apiFetch, API_BASE, stores }) {
  const trace = startLoadTrace('Home', {}, ['bootstrap']);
  try {
    const res = await apiFetch(`${API_BASE}/api/bootstrap`);
    if (res.ok) {
      const data = await res.json();
      stores.useProfileStore.getState().setFromBootstrap(data.profiles);
      stores.useSettingsStore.getState().setFromBootstrap(data.settings);
      stores.useCreditStore.getState().setFromBootstrap(data.credits);
      stores.useProjectsStore.getState().setFromBootstrap(data.projects);
      stores.useGamesDataStore.getState().setFromBootstrap(data.games);
      stores.useQuestStore.getState().setFromBootstrap(data.quests_progress);
      stores.useQuestStore.getState().setPanelCollapsed(data.quest_panel_collapsed);
      stores.useGalleryStore.getState().setFromBootstrap(data.downloads);
      // T10250: mirror the clip-upload caps for the "Add Video" pre-flight
      // size check (no-op if the server predates the field).
      stores.useConfigStore.getState().setFromBootstrap(data.upload_limits);
      // Publish export data for useExportRecovery to consume (avoids separate fetch)
      if (data.exports) {
        window.__bootstrapExports = data.exports;
      }
      window.__bootstrapLoaded = true;
      trace.arrived('bootstrap');
    } else {
      trace.failed('bootstrap', new Error(`bootstrap responded ${res.status}`));
    }
  } catch (err) {
    console.error('[App] Bootstrap failed, falling back to individual fetches:', err);
    trace.failed('bootstrap', err);
    await Promise.all([
      stores.useProfileStore.getState().fetchProfiles(),
      stores.useSettingsStore.getState().loadSettings(),
      stores.useProjectsStore.getState().fetchProjects({ reason: 'bootstrap' }),
      stores.useGamesDataStore.getState().fetchGames({ reason: 'bootstrap' }),
      stores.useQuestStore.getState().fetchProgress(),
      stores.useGalleryStore.getState().fetchCount({ reason: 'bootstrap' }),
    ]);
  }
  trace.settled();
}
