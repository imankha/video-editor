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

/**
 * Read the pending game breadcrumb WITHOUT clearing it.
 *
 * Used by useAnnotateState to seed the early /video src during the first render
 * (T4000), so the <video> element mounts with a src on the first commit. The
 * authoritative consume still happens in AnnotateScreen's mount effect.
 */
export function peekPendingGame() {
  const gameId = sessionStorage.getItem(GAME_ID_KEY);
  if (gameId == null) return null;
  const seekTime = sessionStorage.getItem(GAME_SEEK_KEY);
  const sourceClipId = sessionStorage.getItem(GAME_SOURCE_CLIP_KEY);
  return {
    gameId: parseInt(gameId),
    seekTime: seekTime != null ? parseFloat(seekTime) : null,
    sourceClipId: sourceClipId != null ? parseInt(sourceClipId) : null,
  };
}

export function consumePendingGame() {
  const pending = peekPendingGame();
  if (!pending) return null;
  sessionStorage.removeItem(GAME_ID_KEY);
  sessionStorage.removeItem(GAME_SEEK_KEY);
  sessionStorage.removeItem(GAME_SOURCE_CLIP_KEY);
  return pending;
}

// --- Post-claim recap (T5730) ---
// After a public game link is claimed + imported, the landing is the game
// card / recap (NOT Annotate). ProjectManager consumes this once its games
// have loaded to auto-open the claimed game's recap with a tag-your-athlete
// nudge. Set by ClaimGameView right before it navigates home.

const RECAP_GAME_ID_KEY = 'pendingRecapGameId';

export function setPendingRecap(gameId) {
  sessionStorage.setItem(RECAP_GAME_ID_KEY, gameId.toString());
}

export function consumePendingRecap() {
  const gameId = sessionStorage.getItem(RECAP_GAME_ID_KEY);
  if (gameId == null) return null;
  sessionStorage.removeItem(RECAP_GAME_ID_KEY);
  return parseInt(gameId);
}

// --- Cross-profile game reference (T5820) ---
//
// A reference game card in one profile's Games tab points at the REAL game owned
// by a sibling profile. Clicking it switches to the owning profile and lands on
// its Games tab with the real game scrolled into view + briefly highlighted
// (user decision: a reference is a signpost, so it lands on the game's Games-tab
// context, NOT the Annotate editor — hence a breadcrumb distinct from
// setPendingGame above).
//
// This is TRANSIENT navigation intent, not view state — never a saved
// preference. It is modelled on the read-once `projectManagerTab` hint
// (ProjectManager.jsx): set before switching, consumed once after the switch,
// then cleared. It survives `profileStore._resetDataStores()` because that only
// resets Zustand stores + refetches — it never touches sessionStorage.
//
// The owning game is located in the target profile by its `source_game_id` (the
// owning game's real id, projected by GET /api/games under the is_reference gate —
// T5800). This is an exact id match, so it works for MULTI-VIDEO owning games too
// (those have a NULL blake3_hash, which is why an earlier version of this code had
// to fall back to a hash match and silently skip the highlight for them).

const GAME_REF_PROFILE_KEY = 'pendingGameRefProfileId';
const GAME_REF_GAME_ID_KEY = 'pendingGameRefGameId';
const GAME_REF_PROFILE_NAME_KEY = 'pendingGameRefProfileName';

export function setPendingGameReference({ sourceProfileId, sourceGameId = null, sourceProfileName = null }) {
  sessionStorage.setItem(GAME_REF_PROFILE_KEY, sourceProfileId);
  if (sourceGameId != null) {
    sessionStorage.setItem(GAME_REF_GAME_ID_KEY, sourceGameId.toString());
  }
  if (sourceProfileName != null) {
    sessionStorage.setItem(GAME_REF_PROFILE_NAME_KEY, sourceProfileName);
  }
}

/** Read the reference breadcrumb WITHOUT clearing it (the consume gate waits for
 *  the target profile's games to settle before acting — peek lets it re-check). */
export function peekPendingGameReference() {
  const sourceProfileId = sessionStorage.getItem(GAME_REF_PROFILE_KEY);
  if (sourceProfileId == null) return null;
  const sourceGameId = sessionStorage.getItem(GAME_REF_GAME_ID_KEY);
  return {
    sourceProfileId,
    sourceGameId: sourceGameId != null ? parseInt(sourceGameId) : null,
    sourceProfileName: sessionStorage.getItem(GAME_REF_PROFILE_NAME_KEY),
  };
}

export function consumePendingGameReference() {
  const pending = peekPendingGameReference();
  if (!pending) return null;
  sessionStorage.removeItem(GAME_REF_PROFILE_KEY);
  sessionStorage.removeItem(GAME_REF_GAME_ID_KEY);
  sessionStorage.removeItem(GAME_REF_PROFILE_NAME_KEY);
  return pending;
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
