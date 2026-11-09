import { DEEP_LINK_KIND } from '../constants/deepLinkKinds';
import { EDITOR_MODES, modeFromPath, parseEditorPath, useEditorStore } from '../stores/editorStore';
import { useGamesDataStore } from '../stores/gamesDataStore';
import { useProjectsStore } from '../stores/projectsStore';
import { deleteResumePoint } from './resumePoint';
import { showNotHereNotice } from './deepLinkRecovery';
import { setPendingGame } from './pendingNavigation';

const RESUME_MAX_AGE_DAYS = 30;

/**
 * A row with no `path` is treated as absent. `left_at` is set only by the exit
 * beacon (best effort) -- a navigation-gesture write, or the last write before a
 * suppressed sign-out beacon (T15360), always carries `left_at: null`. The
 * server already dropped anything older than RESUME_MAX_AGE_DAYS before handing
 * the point back (its own `updated_at` column -- resume_points.get_resume_point),
 * so a missing `left_at` must NOT be treated as stale; only re-check the age
 * client-side when `left_at` is actually present.
 */
export function isFreshResumePoint(resumePoint) {
  if (!resumePoint?.path) return false;
  if (!resumePoint.left_at) return true;
  const ageMs = Date.now() - new Date(resumePoint.left_at).getTime();
  return Number.isFinite(ageMs) && ageMs >= 0 && ageMs < RESUME_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
}

/** Target no longer exists: land on Home with the notice, clear the point so it can't loop. */
function landMissing(kind) {
  deleteResumePoint();
  showNotHereNotice(kind);
}

/**
 * Cold-load restore (T14980): a bare `/` arrival with no deep link, share, claim or
 * payment-return already claimed the landing opens the resume point's object. Read-only and
 * validated against the lists bootstrap already loaded (never a fresh fetch, so this stays a
 * single read, same rule as the rest of restore). The caller (App.jsx) gates on bare `/` and
 * absence of those other arrivals BEFORE calling this -- this function assumes that gate held.
 */
export function restoreFromResumePoint(resumePoint) {
  if (!isFreshResumePoint(resumePoint)) return;

  const mode = modeFromPath(resumePoint.path);
  const { gameId, projectId, seekTime } = parseEditorPath(resumePoint.path);

  if (mode === EDITOR_MODES.ANNOTATE && gameId != null) {
    const game = useGamesDataStore.getState().games.find((g) => g.id === gameId);
    if (!game) {
      landMissing(DEEP_LINK_KIND.GAME);
      return;
    }
    // The playhead is on the point itself (resumePoint.t), not necessarily the path's `?t=` --
    // the exit beacon fills the former at the moment the tab closed.
    setPendingGame(gameId, seekTime ?? resumePoint.t ?? null);
    useEditorStore.getState().setEditorMode(EDITOR_MODES.ANNOTATE);
    return;
  }

  if ((mode === EDITOR_MODES.FRAMING || mode === EDITOR_MODES.OVERLAY) && projectId != null) {
    const project = useProjectsStore.getState().projects.find((p) => p.id === projectId);
    if (!project) {
      landMissing(DEEP_LINK_KIND.PROJECT);
      return;
    }
    useProjectsStore.getState().selectProject(projectId);
    // T15340: same rule as Annotate above -- the point's own `t` (exit beacon) is
    // the playhead; the path's `?t=` wins only when parseEditorPath already
    // resolved one. The mode view consumes it once it has a working video to seek.
    useEditorStore.getState().setEditorMode(mode, { projectId, seekTime: seekTime ?? resumePoint.t ?? null });
    return;
  }

  if (mode === EDITOR_MODES.PROJECT_MANAGER) {
    useEditorStore.getState().setEditorMode(EDITOR_MODES.PROJECT_MANAGER);
  }
  // Any other resolved mode (e.g. admin) or an unresolved one is never a restore target.
}
