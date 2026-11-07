import { create } from 'zustand';
import { SECTION_NAMES, MODE_NAMES } from '../config/displayNames';
import { DEEP_LINK_KIND } from '../constants/deepLinkKinds';
import {
  restorePendingGameAfterReload,
  peekPendingGame,
  consumePendingGame,
  clearPendingProject,
  clearAnnotateResume,
  adoptUrlGame,
  adoptUrlProject,
} from '../utils/pendingNavigation';
import { getProfileId } from '../utils/sessionInit';
import { CAMPAIGN_PARAMS } from '../utils/campaignCapture';
import { useProfileStore } from './profileStore';
import { useFocusStore } from './focusStore';
import { useProjectDataStore } from './projectDataStore';
import { useOverlayStore } from './overlayStore';
import { useProjectsStore } from './projectsStore';
import { useVideoStore } from './videoStore';

/**
 * Editor Modes - String constants for mode comparisons
 *
 * Use these instead of magic strings like 'framing' or 'overlay'.
 * This prevents typos and enables IDE autocomplete.
 */
export const EDITOR_MODES = {
  FRAMING: 'framing',
  OVERLAY: 'overlay',
  ANNOTATE: 'annotate',
  PROJECT_MANAGER: 'project-manager',
  ADMIN: 'admin',
};

export const MODE_PATHS = {
  [EDITOR_MODES.PROJECT_MANAGER]: '/home',
  [EDITOR_MODES.ANNOTATE]: '/annotate',
  [EDITOR_MODES.FRAMING]: '/focus',
  [EDITOR_MODES.OVERLAY]: '/overlay',
  [EDITOR_MODES.ADMIN]: '/admin',
};

export const PATH_TO_MODE = Object.fromEntries(
  Object.entries(MODE_PATHS).map(([mode, path]) => [path, mode])
);

// Legacy URL aliases (T7700). The Framing step was renamed Focus and its route
// moved '/framing' -> '/focus'; old bookmarks/history entries must still resolve
// (not fall through to the null -> Project Manager fallback). Mapped to the new
// path BEFORE the PATH_TO_MODE lookup, so both cold-load and popstate resolve the
// mode; the cold-load canonicalization then rewrites the URL to the new path.
export const LEGACY_PATH_REDIRECTS = {
  '/framing': '/focus',
};

// Home tab deep-link sub-routes. The active tab is URL state (never persisted);
// ProjectManager reads the path on mount to pick its tab. These must survive the
// cold-load URL canonicalization below — collapsing them to /home would drop the
// deep link before ProjectManager can read it. T8555 added /home/published; T11230
// removed the /home/reels-in-progress (In Progress Reels) tab with the Reels
// building surfaces, so an old deep link to it now names no tab and falls through
// to the bare-/home default (Home) via ProjectManager's tabFromPath -> null (R6:
// any unsupported link goes Home, no special redirect). MUST stay in lockstep with
// ProjectManager's TAB_PATHS. (/home/reels stays the frozen In Progress Clips URL.)
export const HOME_TAB_PATHS = ['/home/games', '/home/reels', '/home/published'];
const HOME_GAMES_PATH = '/home/games';

// T14970: canonical editor URLs. The path names the object being edited, so a page can
// be reloaded, bookmarked or sent to support. Only the object goes here, never view state.
//   /annotate/g/{gameId}?profile={profileId}[&t={seconds}]
//   /focus/p/{projectId}?profile={profileId}   /overlay/p/{projectId}?profile={profileId}
// Ids are per-profile, so the profile says which object. A URL without one is an old bookmark.
// 15 digits stays inside Number's exact range; a longer run is not an id.
const ANNOTATE_GAME_PATH = /^\/annotate\/g\/(\d{1,15})\/?$/;
const EDITOR_PROJECT_PATH = /^\/(focus|overlay)\/p\/(\d{1,15})\/?$/;
const ANNOTATE_GAME_PATH_SHAPE = /^\/annotate\/g\/.+/;
const EDITOR_PROJECT_PATH_SHAPE = /^\/(focus|overlay)\/p\/.+/;
const PROFILE_ID_SHAPE = /^[a-f0-9]{8}$/;

/**
 * Resolve the editor mode a URL path maps to, or null when the path names no
 * known mode. Known editor paths map directly; /home and its tab sub-routes
 * (/home/games, /home/reels) are the project manager. Shared by cold-load init
 * and the popstate handler so the two can never drift.
 */
export function modeFromPath(pathname = window.location.pathname) {
  const resolved = LEGACY_PATH_REDIRECTS[pathname] || pathname;
  if (ANNOTATE_GAME_PATH.test(resolved)) return EDITOR_MODES.ANNOTATE;
  const projectPath = resolved.match(EDITOR_PROJECT_PATH);
  if (projectPath) return PATH_TO_MODE[`/${projectPath[1]}`];
  return PATH_TO_MODE[resolved]
    || (resolved.startsWith('/home') ? EDITOR_MODES.PROJECT_MANAGER : null);
}

/**
 * Read the object a URL names. Ids come back as numbers (selectedProjectId and the
 * game breadcrumb compare strictly, T10740); a bare mode path names nothing.
 */
export function parseEditorPath(pathname = window.location.pathname, search = window.location.search) {
  const game = pathname.match(ANNOTATE_GAME_PATH);
  const project = pathname.match(EDITOR_PROJECT_PATH);
  const params = new URLSearchParams(search);
  const t = game ? params.get('t') : null;
  const seekTime = t === null || t === '' ? NaN : Number(t);
  return {
    gameId: game ? Number(game[1]) : null,
    projectId: project ? Number(project[2]) : null,
    seekTime: Number.isFinite(seekTime) && seekTime >= 0 ? seekTime : null,
    profileId: game || project ? params.get('profile') : null,
  };
}

/**
 * The kind of object a path tried to name with an unusable id (/focus/p/abc), or null.
 * It gets the unknown-id landing rather than the silent unknown-route one.
 */
function malformedObjectKind(pathname, search) {
  const isGamePath = ANNOTATE_GAME_PATH_SHAPE.test(pathname);
  const isProjectPath = EDITOR_PROJECT_PATH_SHAPE.test(pathname);
  if (!isGamePath && !isProjectPath) return null;
  const { profileId } = parseEditorPath(pathname, search);
  const isUsable = modeFromPath(pathname) && (profileId === null || PROFILE_ID_SHAPE.test(profileId));
  if (isUsable) return null;
  return isGamePath ? DEEP_LINK_KIND.GAME : DEEP_LINK_KIND.PROJECT;
}

// Public routes render OUTSIDE the editor (share links, legal pages). The store
// must never normalize/rewrite their URL — doing so at module load clobbers the
// deep link before App reads it, so e.g. /shared/collection/{token} would bounce
// to /framing and force a sign-in. App.jsx owns these routes.
// T5180: /debug/ is the same class of route (main.jsx mounts a bare component
// with no chrome, bypassing App entirely) — without this exclusion, importing
// useEditorStore at main.jsx module scope (for GlobalReportButton) clobbers
// /debug/rich-text back to /home before main.jsx's own code ever reads the path.
const PUBLIC_ROUTE_PREFIXES = ['/shared/', '/privacy', '/terms', '/legal', '/debug/'];
export function isPublicRoute(pathname = window.location.pathname) {
  return PUBLIC_ROUTE_PREFIXES.some((p) => pathname === p || pathname.startsWith(p));
}

/**
 * The canonical path for a mode at this moment of navigation. Resolved here, inside the
 * gesture, so every handler gets it without passing ids: an open sets the game breadcrumb
 * or selects the project just before it switches mode. An explicit id wins; the id already
 * in the path covers a load finishing after its breadcrumb was consumed.
 */
function canonicalPath(mode, { gameId, projectId, seekTime } = {}) {
  const base = MODE_PATHS[mode];
  if (mode === EDITOR_MODES.ANNOTATE) {
    const current = parseEditorPath();
    const id = gameId ?? peekPendingGame()?.gameId ?? current.gameId;
    if (id == null) return base;
    // A `t` the URL already carries stays while this game does; ordinary navigation adds none.
    return `${base}/g/${id}${objectQuery(seekTime ?? (current.gameId === id ? current.seekTime : null))}`;
  }
  if (mode === EDITOR_MODES.FRAMING || mode === EDITOR_MODES.OVERLAY) {
    const id = projectId ?? useProjectsStore.getState().selectedProjectId;
    return id != null ? `${base}/p/${id}${objectQuery()}` : base;
  }
  return base;
}

function objectQuery(seekTime = null) {
  const params = new URLSearchParams();
  const profileId = getProfileId();
  if (profileId) params.set('profile', profileId);
  if (seekTime != null) params.set('t', String(seekTime));
  const query = params.toString();
  return query ? `?${query}` : '';
}

function updatePath(mode, ids) {
  const target = canonicalPath(mode, ids);
  if (!target) return;
  const [path, query] = target.split('?');
  if (window.location.pathname !== path) {
    window.history.pushState({ mode }, '', target);
  } else if (query && window.location.search !== `?${query}`) {
    // Same page, fuller address (an old bookmark gaining its profile): not a new history entry.
    window.history.replaceState({ mode }, '', target);
  }
}

/**
 * Screen Types - Typed screen definitions for navigation
 *
 * Each screen has:
 * - type: Unique identifier (used for routing/comparison)
 * - label: Human-readable name (used in UI)
 *
 * Using objects instead of strings provides:
 * - Type safety (can't accidentally use wrong string)
 * - Exhaustive checking in switch statements
 * - Single source of truth for screen metadata
 */
export const SCREENS = {
  PROJECT_MANAGER: { type: EDITOR_MODES.PROJECT_MANAGER, label: SECTION_NAMES.CLIPS },
  FRAMING: { type: EDITOR_MODES.FRAMING, label: MODE_NAMES.FRAMING },
  OVERLAY: { type: EDITOR_MODES.OVERLAY, label: MODE_NAMES.SPOTLIGHT },
  ANNOTATE: { type: EDITOR_MODES.ANNOTATE, label: MODE_NAMES.ANNOTATE },
};

/**
 * Helper to get screen by type string (for backward compatibility)
 */
export const getScreenByType = (type) => {
  return Object.values(SCREENS).find(s => s.type === type) || SCREENS.PROJECT_MANAGER;
};

/**
 * Top-level app screens. Which one renders is a pure function of editorMode —
 * see resolveEditorScreen. (ADMIN is handled by App before this is consulted.)
 */
export const APP_SCREENS = {
  HOME: 'home',     // ProjectsScreen (project/game listing)
  EDITOR: 'editor', // annotate/framing/overlay editor frame
};

/**
 * Decide which top-level screen renders. The screen is derived ONLY from
 * editorMode — never inferred from whether a project happens to be selected —
 * so the two can't silently disagree (the failure that rendered a blank editor
 * frame after an overlay export navigated to PROJECT_MANAGER).
 *
 * @param {string} editorMode - current EDITOR_MODES value
 * @param {boolean} hasSelectedProject - whether a project is selected
 * @returns {'home'|'editor'} APP_SCREENS value
 */
export function resolveEditorScreen(editorMode, hasSelectedProject) {
  switch (editorMode) {
    case EDITOR_MODES.PROJECT_MANAGER:
      return APP_SCREENS.HOME;
    case EDITOR_MODES.ANNOTATE:
      // Annotate can render without a selected project (clip import flow).
      return APP_SCREENS.EDITOR;
    case EDITOR_MODES.FRAMING:
    case EDITOR_MODES.OVERLAY:
      if (hasSelectedProject) return APP_SCREENS.EDITOR;
      // Editor mode with no project to edit — route home rather than render an
      // empty editor frame, and log because this is an invalid combination.
      console.warn('[App] editor mode with no selected project; routing home', { editorMode });
      return APP_SCREENS.HOME;
    default:
      // Any unhandled / future mode must never render a blank screen.
      console.error('[App] unhandled editorMode; routing home', { editorMode });
      return APP_SCREENS.HOME;
  }
}

/**
 * Editor Store - Manages editor mode and UI layer selection
 *
 * This store consolidates cross-cutting editor state that was previously
 * managed via useState in App.jsx and passed down through props.
 *
 * State:
 * - editorMode: Current editing mode (string for backward compat, use screen.type)
 * - screen: Current screen object from SCREENS (new typed approach)
 * - modeSwitchDialog: Confirmation dialog state for mode changes
 * - selectedLayer: Active layer for keyboard navigation
 *
 * @see CODE_SMELLS.md #15 for refactoring context
 * @see tasks/PHASE2-ARCHITECTURE-PLAN.md for migration plan
 */
// Cold-load mode is derived purely from the URL. An unrecognized path (typo'd
// URL, stale link, bare "/") resolves to the project manager — the app's home —
// never into an editor, so a bad URL can't drop the user onto whatever project
// state happens to be loaded (T5677).
// T14970: a path with an unusable id or profile lands on Games, so it never picks an editor.
const initialMalformedKind = malformedObjectKind(window.location.pathname, window.location.search);
const initialMode = initialMalformedKind ? EDITOR_MODES.PROJECT_MANAGER : modeFromPath();
// T14970: the URL is the primary carrier of what is open; hand it to the same breadcrumbs
// a tap sets, so the existing consumers open it. T12880: bare /annotate carries no game id,
// so reopen the game the tab was on.
const initialObject = initialMalformedKind
  ? { gameId: null, projectId: null, seekTime: null, profileId: null }
  : parseEditorPath();
if (initialObject.gameId != null) {
  adoptUrlGame(initialObject.gameId, initialObject.seekTime);
} else if (initialObject.projectId != null) {
  adoptUrlProject(initialObject.projectId, initialMode);
} else if (initialMode === EDITOR_MODES.ANNOTATE) {
  restorePendingGameAfterReload();
}

export const useEditorStore = create((set, get) => ({
  // Current screen object (new typed approach). getScreenByType defaults to
  // PROJECT_MANAGER when the mode is null (unknown route).
  screen: getScreenByType(initialMode),

  // Editor mode: 'framing' | 'overlay' | 'annotate' | 'project-manager'
  // DEPRECATED: Use screen.type instead. Kept for backward compatibility.
  editorMode: initialMode || EDITOR_MODES.PROJECT_MANAGER,

  // Mode switch confirmation dialog
  modeSwitchDialog: {
    isOpen: false,
    pendingMode: null,
    sourceMode: null, // 'framing' or 'overlay' - which mode we're leaving
  },

  // Selected layer for arrow key navigation: 'playhead' | 'crop' | 'highlight'
  selectedLayer: 'playhead',

  // Whether a clip is currently selected in annotate mode (drives quest panel auto-collapse)
  annotateHasSelectedClip: false,
  setAnnotateHasSelectedClip: (value) => set({ annotateHasSelectedClip: value }),

  // T8180: the game id the annotate screen is currently bound to (mirror of
  // useAnnotateState's annotateGameId, synced from AnnotateContainer). Pure client UI
  // state — never persisted. Read by uploadManager's failure-cleanup path (a service
  // that cannot see React hook state) to skip the only_if_empty DELETE when the user
  // is still annotating the game whose upload just failed (annotate-during-upload,
  // T1540). null when no game is loaded.
  activeAnnotateGameId: null,
  setActiveAnnotateGameId: (gameId) => set({ activeAnnotateGameId: gameId ?? null }),

  // T14970: bumped when the URL (not a tap) asks for a different object in place, so the
  // breadcrumb consumers run again. Back and forward between two plays is the case.
  urlNavigationSeq: 0,

  // T14970: the game a URL asked for, so a 404 on it can look in the user's other profiles.
  // A stale tap in the session has no URL behind it and keeps its own error.
  urlOpenGameId: initialObject.gameId,

  // T14970: bumped by redirectToGamesTab. Home's tab is local state, read from the URL only on
  // mount, so a Home already on screen needs telling.
  gamesTabRequest: 0,

  // T14970: a URL named something unusable and the user landed on Games. ProjectsScreen shows
  // this, because the store can run before the toast layer. `unavailable` means we could not
  // tell, so the notice must not say it is gone.
  urlLandingNotice: initialMalformedKind ? { kind: initialMalformedKind, unavailable: false } : null,

  /** The notice to show, once. */
  takeUrlLandingNotice: () => {
    const notice = get().urlLandingNotice;
    if (notice) set({ urlLandingNotice: null });
    return notice;
  },

  /** The URL named a profile that cannot be used. Nothing it queued may open anywhere else. */
  rejectUrlProfile: ({ kind, unavailable }) => {
    consumePendingGame();
    clearAnnotateResume();
    clearPendingProject();
    set({ urlOpenGameId: null, urlLandingNotice: { kind, unavailable } });
    get().redirectToGamesTab();
  },

  /** True once, when this open of gameId came from the URL. */
  takeUrlOpenGame: (gameId) => {
    if (get().urlOpenGameId !== gameId) return false;
    set({ urlOpenGameId: null });
    return true;
  },

  /**
   * A new upload has no id when Annotate opens; replace the bare path once the game exists.
   * Called from the create gesture's continuation, never from an effect.
   */
  bindAnnotateGamePath: (gameId) => {
    window.history.replaceState({ mode: EDITOR_MODES.ANNOTATE }, '', canonicalPath(EDITOR_MODES.ANNOTATE, { gameId }));
  },

  /** Land on the Games tab, replacing the entry that named a missing object. */
  redirectToGamesTab: () => {
    window.history.replaceState({ mode: EDITOR_MODES.PROJECT_MANAGER }, '', HOME_GAMES_PATH);
    set({
      editorMode: EDITOR_MODES.PROJECT_MANAGER,
      screen: getScreenByType(EDITOR_MODES.PROJECT_MANAGER),
      gamesTabRequest: get().gamesTabRequest + 1,
    });
  },

  // Actions

  /**
   * Navigate to a screen (new typed approach)
   * @param {Object} screen - Screen object from SCREENS
   */
  navigateTo: (screen) => {
    updatePath(screen.type);
    set({
      screen,
      editorMode: screen.type,
    });
  },

  /**
   * Set the editor mode directly (use when no confirmation needed)
   * DEPRECATED: Use navigateTo(SCREENS.X) instead for type safety
   */
  setEditorMode: (mode, ids) => {
    updatePath(mode, ids);
    set({
      editorMode: mode,
      screen: getScreenByType(mode),
    });
  },

  /**
   * Navigate home to the Project Manager as ONE atomic transition: clear the
   * project selection, reset the video, and switch mode together. Doing these
   * as separate calls from a caller lets an in-flight async (e.g. a project
   * refresh) interleave and resurrect the selection after it was cleared,
   * leaving editorMode === PROJECT_MANAGER while selectedProject is still set —
   * a state App.jsx cannot render. Owning the whole transition here prevents that.
   */
  goToProjectManager: () => {
    useProjectsStore.getState().clearSelection();
    useVideoStore.getState().reset();
    updatePath(EDITOR_MODES.PROJECT_MANAGER);
    set({
      editorMode: EDITOR_MODES.PROJECT_MANAGER,
      screen: getScreenByType(EDITOR_MODES.PROJECT_MANAGER),
    });
  },

  /**
   * Update mode to match browser history (popstate) without pushing a new entry.
   */
  setEditorModeFromPopState: (mode, { urlOpenGameId = null, objectChanged = false } = {}) => {
    set((state) => ({
      editorMode: mode,
      screen: getScreenByType(mode),
      urlOpenGameId,
      urlNavigationSeq: objectChanged ? state.urlNavigationSeq + 1 : state.urlNavigationSeq,
    }));
  },

  /**
   * Redirect to a mode, replacing the current history entry (no new pushState).
   * Use for error/fallback redirects to avoid back-button loops.
   */
  redirectToMode: (mode) => {
    const path = canonicalPath(mode);
    if (path) {
      window.history.replaceState({ mode }, '', path);
    }
    set({
      editorMode: mode,
      screen: getScreenByType(mode),
    });
  },

  /**
   * Open the mode switch confirmation dialog
   * @param {string} pendingMode - The mode user wants to switch to
   * @param {string} sourceMode - The mode we're leaving ('framing' or 'overlay')
   */
  openModeSwitchDialog: (pendingMode, sourceMode = 'framing') => set({
    modeSwitchDialog: { isOpen: true, pendingMode, sourceMode }
  }),

  /**
   * Close the mode switch dialog without changing mode
   */
  closeModeSwitchDialog: () => set({
    modeSwitchDialog: { isOpen: false, pendingMode: null, sourceMode: null }
  }),

  /**
   * Confirm mode switch - closes dialog and changes mode
   */
  confirmModeSwitch: () => {
    const { modeSwitchDialog } = get();
    if (modeSwitchDialog.pendingMode) {
      updatePath(modeSwitchDialog.pendingMode);
      set({
        editorMode: modeSwitchDialog.pendingMode,
        screen: getScreenByType(modeSwitchDialog.pendingMode),
        modeSwitchDialog: { isOpen: false, pendingMode: null }
      });
    }
  },

  /**
   * Set the selected layer for keyboard navigation
   * @param {'playhead' | 'crop' | 'highlight'} layer
   */
  setSelectedLayer: (layer) => set({ selectedLayer: layer }),

  // Computed/derived values as functions

  /**
   * Check if current screen matches the given screen
   * @param {Object} screen - Screen object from SCREENS
   */
  isScreen: (screen) => get().screen.type === screen.type,

  /**
   * Check if currently in framing mode
   * DEPRECATED: Use isScreen(SCREENS.FRAMING) instead
   */
  isFramingMode: () => get().editorMode === EDITOR_MODES.FRAMING,

  /**
   * Check if currently in overlay mode
   * DEPRECATED: Use isScreen(SCREENS.OVERLAY) instead
   */
  isOverlayMode: () => get().editorMode === EDITOR_MODES.OVERLAY,

  /**
   * Check if currently in annotate mode
   * DEPRECATED: Use isScreen(SCREENS.ANNOTATE) instead
   */
  isAnnotateMode: () => get().editorMode === EDITOR_MODES.ANNOTATE,

  /**
   * Check if currently in project manager
   */
  isProjectManager: () => get().editorMode === EDITOR_MODES.PROJECT_MANAGER,
}));

export default useEditorStore;

// Popstate handler — registered at module scope (outside React lifecycle) so it
// survives React StrictMode's mount-cleanup-remount cycle in development.
// All state reads use getState() at call time so there are no stale closures.
// On HMR re-evaluation, the old handler is removed and a new one registered
// so it always references the current store instance.
let latestPopId = 0;

async function handlePopState() {
  const pathname = window.location.pathname;
  const targetMode = modeFromPath(pathname);
  const { editorMode: currentMode, activeAnnotateGameId } = useEditorStore.getState();
  if (!targetMode) return;

  const { gameId, projectId, seekTime, profileId } = parseEditorPath(pathname);
  // The same id in another profile is another object.
  const profileChanged = profileId != null && profileId !== getProfileId();
  const gameChanged = gameId != null
    && (profileChanged || currentMode !== EDITOR_MODES.ANNOTATE || gameId !== activeAnnotateGameId);
  const projectChanged = projectId != null
    && (profileChanged || projectId !== useProjectsStore.getState().selectedProjectId);
  const objectChanged = gameChanged || projectChanged;
  if (targetMode === currentMode && !objectChanged) return;

  // Same mode, different object skips these: edits persist per gesture, so nothing is lost,
  // and the dialog only knows how to change mode.
  if (targetMode !== currentMode) {
    if (currentMode === EDITOR_MODES.FRAMING
        && useFocusStore.getState().framingChangedSinceExport
        && useProjectDataStore.getState().workingVideo?.url) {
      window.history.pushState({ mode: currentMode }, '', canonicalPath(currentMode));
      useEditorStore.getState().openModeSwitchDialog(targetMode, EDITOR_MODES.FRAMING);
      return;
    }

    if (currentMode === EDITOR_MODES.OVERLAY
        && useOverlayStore.getState().overlayChangedSinceExport
        && useProjectsStore.getState().selectedProject?.has_final_video) {
      window.history.pushState({ mode: currentMode }, '', canonicalPath(currentMode));
      useEditorStore.getState().openModeSwitchDialog(targetMode, EDITOR_MODES.OVERLAY);
      return;
    }
  }

  // The entry's profile goes in before anything opens. Home holds the screen meanwhile, so no
  // editor is mounted while its stores are swapped.
  if (profileChanged) {
    const popId = ++latestPopId;
    useProjectsStore.getState().clearSelection();
    useVideoStore.getState().reset();
    useEditorStore.getState().setEditorModeFromPopState(EDITOR_MODES.PROJECT_MANAGER);
    const kind = gameId != null ? DEEP_LINK_KIND.GAME : DEEP_LINK_KIND.PROJECT;
    let adopted = false;
    try {
      adopted = await useProfileStore.getState().adoptTabProfile(profileId);
    } catch (err) {
      console.warn('[editorStore] could not adopt the history entry\'s profile:', err.message);
      if (popId === latestPopId) useEditorStore.getState().rejectUrlProfile({ kind, unavailable: true });
      return;
    }
    if (popId !== latestPopId) return;
    if (!adopted) {
      useEditorStore.getState().rejectUrlProfile({ kind, unavailable: false });
      return;
    }
  }

  if (targetMode === EDITOR_MODES.PROJECT_MANAGER) {
    useProjectsStore.getState().clearSelection();
    requestAnimationFrame(() => useProjectsStore.getState().fetchProjects());
  }

  // Clearing the selection routes through home, where ProjectsScreen's resume opens the play.
  if (projectChanged) {
    useProjectsStore.getState().clearSelection();
    adoptUrlProject(projectId, targetMode);
  }
  if (gameChanged) adoptUrlGame(gameId, seekTime);

  useVideoStore.getState().reset();
  useEditorStore.getState().setEditorModeFromPopState(targetMode, {
    urlOpenGameId: gameChanged ? gameId : null,
    objectChanged,
  });
}

const APP_READ_PARAMS = [...CAMPAIGN_PARAMS, 'payment', 'session_id'];

if (window.__popstateHandler) {
  window.removeEventListener('popstate', window.__popstateHandler);
} else if (!isPublicRoute()) {
  // Seed history.state with the mode + canonicalize the URL (e.g. '/' or an
  // unknown route -> the mode path), but NEVER on public routes (share links /
  // legal pages) — that would discard the deep link. Preserve the home tab
  // sub-routes verbatim: the tab is URL state, so collapsing /home/games to
  // /home here would bounce a cold-load deep link back to the default tab (T5677).
  const mode = useEditorStore.getState().editorMode;
  const path = window.location.pathname;
  const hasObject = initialObject.gameId != null || initialObject.projectId != null;
  const keepsPath = HOME_TAB_PATHS.includes(path) || hasObject;
  const coldPath = initialMalformedKind ? HOME_GAMES_PATH : (keepsPath ? path : (MODE_PATHS[mode] || '/home'));
  // T11500: DEV-only ?dev_account=<preset> login link must survive until
  // initSession() reads it (sessionInit.js), so carry just that param across.
  const devAccount = import.meta.env.DEV
    ? new URLSearchParams(window.location.search).get('dev_account')
    : null;
  const params = new URLSearchParams();
  if (devAccount) params.set('dev_account', devAccount);
  if (initialObject.profileId != null) params.set('profile', initialObject.profileId);
  if (initialObject.seekTime != null) params.set('t', String(initialObject.seekTime));
  // T7670: the upload-complete email link, which App reads after this runs.
  const incoming = new URLSearchParams(window.location.search);
  if (incoming.has('game')) {
    params.set('game', incoming.get('game'));
    if (incoming.has('profile')) params.set('profile', incoming.get('profile'));
  }
  // T15220: the arrival params App reads after this runs. App removes them once read.
  APP_READ_PARAMS.forEach((name) => {
    if (incoming.has(name)) params.set(name, incoming.get(name));
  });
  const query = params.toString();
  window.history.replaceState({ mode }, '', coldPath + (query ? `?${query}` : ''));
}
window.__popstateHandler = handlePopState;
window.addEventListener('popstate', handlePopState);
