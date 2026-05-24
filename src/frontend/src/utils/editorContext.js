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

  const ctx = {
    mode: editor.editorMode,
    profileId: profile.currentProfileId,
    project: projects.selectedProjectId
      ? {
          id: projects.selectedProjectId,
          clipCount: projectData.clips?.length ?? 0,
          selectedClipId: projectData.selectedClipId,
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

  if (editor.editorMode === 'annotate' && _annotateSnapshot) {
    ctx.annotate = _annotateSnapshot;
  }

  if (editor.editorMode === 'framing') {
    ctx.framing = {
      currentClipId: framing.currentClipId,
      changedSinceExport: framing.framingChangedSinceExport,
    };
  }

  if (editor.editorMode === 'overlay') {
    ctx.overlay = {
      effectType: overlay.effectType,
      changedSinceExport: overlay.overlayChangedSinceExport,
    };
  }

  return ctx;
}

function round1(n) {
  if (n == null) return null;
  return Math.round(n * 10) / 10;
}
