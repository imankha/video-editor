/**
 * T13810: window.__syncCheck({ rawClipId?, projectId?, gameId? })
 *
 * Fetches server truth (GET /api/qa/sync-state + the collections summary when the
 * Published panel is mounted) and diffs it against every client holder of the same
 * data. Each mismatch row names the holder, both values, the holder's last refresh
 * (reason, reqId, age) and the newest write that did NOT refresh it -- the diagnosis.
 *
 * Read-only: nothing is written to the store, the backend, or storage.
 */
import { API_BASE } from '../config';
import apiFetch from './apiFetch';
import { diffHolders, getRegisteredHolder, recordSync, summarizeCollections } from './syncTrace';
import { mapHighlightInstances } from '../modes/annotate/highlightInstances';
import { getClipStages } from '../modes/annotate/clipStage';
import { useGalleryStore } from '../stores/galleryStore';
import { useProjectsStore } from '../stores/projectsStore';
import { useGamesDataStore } from '../stores/gamesDataStore';

const ATTRIBUTE_DERIVED = { 'derive.clipStages': 'annotate.highlightInstances' };

const flags = (instances) => (instances || []).map((i) => ({
  projectId: i.projectId, orientation: i.aspectRatio ?? i.orientation,
  isPublished: !!i.isPublished, hasFinalVideo: !!i.hasFinalVideo, hasWorkingVideo: !!i.hasWorkingVideo,
}));

// Stage the user sees, derived from flag-shaped instances (same fn the Annotate card uses).
function stagesOf(rawClipId, instances) {
  const list = (instances || []).map((i) => ({
    projectId: i.projectId, aspectRatio: i.orientation, isPublished: i.isPublished,
    hasFinalVideo: i.hasFinalVideo, hasWorkingVideo: i.hasWorkingVideo,
  }));
  const region = { autoProjectId: list[0]?.projectId ?? null, rawClipId };
  return getClipStages(region, list).instances.map((i) => [i.projectId ?? null, i.stage]);
}

// The panel holds null until it has anything to show; an empty summary is the same thing.
// Applied to BOTH sides so "nothing to show" never reads as a mismatch.
const emptyAsNull = (sum) => (sum && (sum.total || sum.mixes || sum.games.length) ? sum : null);

/** Pure: snapshot of every client holder relevant to the ids. Unmounted/absent holders are omitted. */
export function buildClientHolders(state, { projectId, rawClipId, gameId } = {}) {
  const out = {
    'galleryStore.count': { count: state.gallery.count, unwatched: state.gallery.unwatchedCount },
  };
  if (projectId != null) {
    const p = state.projects.find((x) => x.id === projectId);
    out['projectsStore.projects'] = {
      present: !!p, is_published: p?.is_published ? 1 : 0,
      has_final_video: p?.has_final_video ? 1 : 0, is_auto_created: p?.is_auto_created ? 1 : 0,
    };
    if (state.selectedProjectId === projectId && state.selectedProject) {
      out['projectsStore.selectedProject'] = {
        is_published: state.selectedProject.is_published ? 1 : 0,
        has_final_video: state.selectedProject.has_final_video ? 1 : 0,
      };
    }
    if (state.gallery.justPublished) {
      out['galleryStore.justPublished'] = { finalVideoId: state.gallery.justPublished.finalVideoId, published: true };
    }
  }
  if (gameId != null) {
    const g = state.games.find((x) => x.id === gameId);
    out['gamesDataStore.games'] = { reel_count: g?.reel_count ?? null };
  }
  const reg = state.registered || {};
  if (reg['collections.summary'] !== undefined) out['collections.summary'] = emptyAsNull(reg['collections.summary']);
  const instances = rawClipId != null ? reg['annotate.highlightInstances']?.[rawClipId] : undefined;
  if (instances) {
    out['annotate.highlightInstances'] = flags(instances);
    out['derive.clipStages'] = stagesOf(rawClipId, flags(instances));
  }
  return out;
}

/** Pure: the same holder keys, valued from server truth. */
export function buildServerHolders(probe, collectionsSummary, { projectId, rawClipId, gameId } = {}) {
  const c = probe.counts || {};
  const out = {
    'galleryStore.count': { count: c.downloads_count, unwatched: c.downloads_unwatched ?? 0 },
  };
  if (projectId != null) {
    const p = probe.project;
    const server = {
      // /api/projects excludes archived projects, so an archived one is correctly absent client-side.
      present: !!p && !p.archived_at, is_published: p?.is_published ? 1 : 0,
      has_final_video: p?.has_final_video ? 1 : 0, is_auto_created: p?.is_auto_created ? 1 : 0,
    };
    // An absent project has no list row, so the client side is all-zero; compare like with like.
    out['projectsStore.projects'] = server.present ? server
      : { present: false, is_published: 0, has_final_video: 0, is_auto_created: 0 };
    out['projectsStore.selectedProject'] = { is_published: server.is_published, has_final_video: server.has_final_video };
    out['galleryStore.justPublished'] = null; // value filled by publishedFinalVideo() below when compared
    out.__finalVideos = probe.final_videos || [];
  }
  if (gameId != null) out['gamesDataStore.games'] = { reel_count: c.game_reel_count };
  if (collectionsSummary) out['collections.summary'] = emptyAsNull(summarizeCollections(collectionsSummary));
  const serverInstances = flags(mapHighlightInstances(probe.highlight_instances));
  out['annotate.highlightInstances'] = serverInstances;
  out['derive.clipStages'] = stagesOf(rawClipId, serverInstances);
  return out;
}

/** Pure: diff and shape the report. */
export function checkSync(client, server) {
  const resolved = { ...server };
  // justPublished: the client expects its final video to be published on the server.
  if (client['galleryStore.justPublished']) {
    const fv = (server.__finalVideos || []).find((v) => v.id === client['galleryStore.justPublished'].finalVideoId);
    resolved['galleryStore.justPublished'] = { finalVideoId: client['galleryStore.justPublished'].finalVideoId, published: !!fv?.published_at };
  }
  const mismatches = diffHolders(client, resolved, ATTRIBUTE_DERIVED);
  return { mismatches, stageMismatch: mismatches.some((m) => m.holder === 'derive.clipStages') };
}

export async function syncCheck(ids = {}) {
  const q = new URLSearchParams();
  if (ids.projectId != null) q.set('project_id', ids.projectId);
  if (ids.rawClipId != null) q.set('raw_clip_id', ids.rawClipId);
  if (ids.gameId != null) q.set('game_id', ids.gameId);
  const res = await apiFetch(`${API_BASE}/api/qa/sync-state?${q}`);
  if (!res.ok) throw new Error(`sync-state failed: ${res.status}`);
  const probe = await res.json();
  let collections = null;
  const registeredSummary = getRegisteredHolder('collections.summary');
  if (registeredSummary !== undefined) {
    const cres = await apiFetch(`${API_BASE}/api/collections/summary`);
    if (cres.ok) collections = await cres.json();
  }
  const rawClipId = ids.rawClipId ?? probe.raw_clip?.id ?? null;
  const resolvedIds = { ...ids, rawClipId };
  const projects = useProjectsStore.getState();
  const client = buildClientHolders({
    gallery: useGalleryStore.getState(),
    projects: projects.projects,
    selectedProjectId: projects.selectedProjectId,
    selectedProject: projects.selectedProject,
    games: useGamesDataStore.getState().games,
    registered: {
      'collections.summary': registeredSummary,
      'annotate.highlightInstances': getRegisteredHolder('annotate.highlightInstances'),
    },
  }, resolvedIds);
  const server = buildServerHolders(probe, collections, resolvedIds);
  const report = checkSync(client, server);
  recordSync({
    kind: 'check', holder: 'syncCheck', reason: 'manual', reqId: res.reqId,
    summary: { ids: resolvedIds, mismatches: report.mismatches.map((m) => m.holder) },
  });
  if (report.mismatches.length === 0) {
    console.log('[SYNC CHECK] 0 mismatches', resolvedIds);
  } else {
    console.warn(`[SYNC CHECK] ${report.mismatches.length} mismatch(es)`, resolvedIds);
    console.table(report.mismatches.map((m) => ({
      holder: m.holder,
      client: JSON.stringify(m.client),
      server: JSON.stringify(m.server),
      lastRefresh: m.lastRefresh ? `${m.lastRefresh.reason} req=${m.lastRefresh.reqId ?? '-'} ${Math.round(m.lastRefreshAgeMs / 1000)}s ago` : 'never',
      newerWriteNotRefreshing: m.newerWrite ? `${m.newerWrite.holder} (${m.newerWrite.reason}) req=${m.newerWrite.reqId ?? '-'} ${Math.round(m.newerWrite.ageMs / 1000)}s ago` : '-',
    })));
  }
  return report;
}

if (typeof window !== 'undefined') window.__syncCheck = syncCheck;
