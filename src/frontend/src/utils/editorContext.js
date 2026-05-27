/**
 * Editor context snapshot — captures current editor state at report time
 * for debugging. Reads from Zustand stores + a module-level annotate snapshot.
 *
 * Annotate state lives in a React hook (useAnnotate), not a store, so
 * the hook pushes its state here via setAnnotateSnapshot().
 */

import { useEditorStore } from '../stores/editorStore.js';
import { useProjectsStore } from '../stores/projectsStore.js';
import { useProjectDataStore } from '../stores/projectDataStore.js';
import { useGamesDataStore } from '../stores/gamesDataStore.js';
import { useVideoStore } from '../stores/videoStore.js';
import { useFramingStore } from '../stores/framingStore.js';
import { useOverlayStore } from '../stores/overlayStore.js';
import { useProfileStore } from '../stores/profileStore.js';

let _annotateSnapshot = null;

/**
 * Called by useAnnotate to keep the annotate context up to date.
 * Pass null when unmounting / leaving annotate mode.
 */
export function setAnnotateSnapshot(data) {
  _annotateSnapshot = data;
}

/**
 * Build a sanitized snapshot of current editor state for bug reports.
 * No PII, no user content — just structural/timing data.
 */
export function getEditorContext() {
  const editor = useEditorStore.getState();
  const projects = useProjectsStore.getState();
  const projectData = useProjectDataStore.getState();
  const games = useGamesDataStore.getState();
  const video = useVideoStore.getState();
  const framing = useFramingStore.getState();
  const overlay = useOverlayStore.getState();
  const profile = useProfileStore.getState();

  const path = window.location.pathname;
  const mode = modeFromRoute(path) ?? editor.editorMode;

  const ctx = {
    mode,
    profileId: profile.currentProfileId,
    route: path,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    project: projects.selectedProjectId
      ? {
          id: projects.selectedProjectId,
          clipCount: projectData.clips?.length ?? 0,
          selectedClipId: projectData.selectedClipId,
          aspectRatio: projectData.aspectRatio,
        }
      : null,
    game: games.selectedGame
      ? { id: games.selectedGame.id, name: games.selectedGame.name }
      : null,
    video: {
      currentTime: round1(video.currentTime),
      duration: round1(video.duration),
      isPlaying: video.isPlaying,
      isLoading: video.isLoading,
    },
  };

  if (mode === 'annotate' && _annotateSnapshot) {
    ctx.annotate = _annotateSnapshot;
  }

  if (mode === 'framing') {
    const clipState = framing.currentClipId ? framing.getClipState(framing.currentClipId) : null;
    ctx.framing = {
      currentClipId: framing.currentClipId,
      changedSinceExport: framing.framingChangedSinceExport,
      keyframeCount: clipState?.keyframes?.length ?? null,
      segmentCount: clipState?.segments?.length ?? null,
      hasExported: framing.hasExported,
    };
  }

  if (mode === 'overlay') {
    ctx.overlay = {
      effectType: overlay.effectType,
      changedSinceExport: overlay.overlayChangedSinceExport,
      highlightColor: overlay.highlightColor,
      highlightShape: overlay.highlightShape,
      strokeWidth: overlay.strokeWidth,
      fillEnabled: overlay.fillEnabled,
      dimStrength: overlay.dimStrength,
      isLoadingWorkingVideo: overlay.isLoadingWorkingVideo,
    };
  }

  return ctx;
}

function modeFromRoute(path) {
  if (path.startsWith('/annotate')) return 'annotate';
  if (path.startsWith('/framing')) return 'framing';
  if (path.startsWith('/overlay')) return 'overlay';
  if (path.startsWith('/home')) return 'home';
  if (path.startsWith('/admin')) return 'admin';
  if (path.startsWith('/gallery') || path.startsWith('/downloads')) return 'gallery';
  return null;
}

function round1(n) {
  if (n == null) return null;
  return Math.round(n * 10) / 10;
}
