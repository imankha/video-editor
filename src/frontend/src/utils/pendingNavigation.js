/**
 * pendingNavigation - sessionStorage breadcrumbs for in-flight navigation.
 *
 * Game/project selection lives only in memory (Zustand stores), but some flows
 * force a full page reload mid-navigation:
 *  - lazyWithReload (App.jsx): post-deploy stale chunk hash triggers a reload
 *  - cross-device login (authStore): reload to reset all stores
 *
 * The breadcrumb records what the user clicked so the app can resume the
 * navigation after the reload instead of dropping the user back on the home
 * screen. editorStore restores the *mode* from the URL at init; these helpers
 * restore the *selection* that goes with it.
 *
 * Pattern: set before navigating to a lazy-loaded screen, consume (read +
 * clear) at the restore site, clear once the navigation has completed so a
 * later home visit can't replay it.
 */

const GAME_ID_KEY = 'pendingGameId';
const GAME_SEEK_KEY = 'pendingClipSeekTime';
const GAME_SOURCE_CLIP_KEY = 'pendingSourceClipId';

const PROJECT_ID_KEY = 'pendingProjectId';
const PROJECT_MODE_KEY = 'pendingProjectMode';
const PROJECT_CLIP_KEY = 'pendingProjectClipIndex';

// --- Games (consumed by AnnotateScreen) ---

export function setPendingGame(gameId, seekTime = null, sourceClipId = null) {
  // [T3960] TEMP diagnostic (branch-only): what gets stored in the breadcrumb.
  console.log('[T3960] setPendingGame', { gameId, seekTime, sourceClipId });
  sessionStorage.setItem(GAME_ID_KEY, gameId.toString());
  if (seekTime != null) {
    sessionStorage.setItem(GAME_SEEK_KEY, seekTime.toString());
  }
  if (sourceClipId != null) {
    sessionStorage.setItem(GAME_SOURCE_CLIP_KEY, sourceClipId.toString());
  }
}

export function hasPendingGame() {
  return sessionStorage.getItem(GAME_ID_KEY) != null;
}

export function consumePendingGame() {
  const gameId = sessionStorage.getItem(GAME_ID_KEY);
  if (gameId == null) return null;
  const seekTime = sessionStorage.getItem(GAME_SEEK_KEY);
  const sourceClipId = sessionStorage.getItem(GAME_SOURCE_CLIP_KEY);
  sessionStorage.removeItem(GAME_ID_KEY);
  sessionStorage.removeItem(GAME_SEEK_KEY);
  sessionStorage.removeItem(GAME_SOURCE_CLIP_KEY);
  const consumed = {
    gameId: parseInt(gameId),
    seekTime: seekTime != null ? parseFloat(seekTime) : null,
    sourceClipId: sourceClipId != null ? parseInt(sourceClipId) : null,
  };
  // [T3960] TEMP diagnostic (branch-only): what the consumer receives.
  console.log('[T3960] consumePendingGame ->', consumed);
  return consumed;
}

// --- Projects/reels (consumed by ProjectsScreen restore effect) ---

export function setPendingProject(projectId, { mode = null, clipIndex = null } = {}) {
  sessionStorage.setItem(PROJECT_ID_KEY, projectId.toString());
  if (mode) {
    sessionStorage.setItem(PROJECT_MODE_KEY, mode);
  }
  if (clipIndex != null) {
    sessionStorage.setItem(PROJECT_CLIP_KEY, clipIndex.toString());
  }
}

export function clearPendingProject() {
  sessionStorage.removeItem(PROJECT_ID_KEY);
  sessionStorage.removeItem(PROJECT_MODE_KEY);
  sessionStorage.removeItem(PROJECT_CLIP_KEY);
}

export function consumePendingProject() {
  const projectId = sessionStorage.getItem(PROJECT_ID_KEY);
  if (projectId == null) return null;
  const mode = sessionStorage.getItem(PROJECT_MODE_KEY);
  const clipIndex = sessionStorage.getItem(PROJECT_CLIP_KEY);
  clearPendingProject();
  return {
    projectId: parseInt(projectId),
    mode: mode || null,
    clipIndex: clipIndex != null ? parseInt(clipIndex) : null,
  };
}
