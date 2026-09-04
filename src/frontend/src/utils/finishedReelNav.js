import { useEditorStore } from '../stores/editorStore';
import { useReelPreviewStore } from '../stores/reelPreviewStore';

/**
 * finishedReelNav (T8530, co-owned with T8520) — the SINGLE way to open the draft
 * preview player after a reel is finished.
 *
 * Snapshots the project's playable fields at open time and hands them to the
 * ephemeral reelPreviewStore. The snapshot must outlive the source row: publish
 * archives the project and the next fetchProjects drops it from projectsStore, so
 * a live store lookup would tear the player down the instant publish succeeds.
 *
 * Fields mirror the CollectionPlayer reel shape (see collections/playerReels.js):
 * `finalVideoId` becomes the reel `id`/streamUrl, `name` -> reel name, plus the
 * header/aspect metadata. DraftReelPreview reshapes this into a one-reel payload.
 *
 * @param {Object} project - a completed draft ({ id, final_video_id, name,
 *   aspect_ratio, clip_count, clip_game_start_time, game_names? })
 */
export function openFinishedReel(project) {
  // No-op if already home; the preview is a fullscreen overlay over the manager.
  useEditorStore.getState().goToProjectManager();
  useReelPreviewStore.getState().open({
    projectId: project.id,
    finalVideoId: project.final_video_id,
    name: project.name,
    aspectRatio: project.aspect_ratio,
    clipCount: project.clip_count,
    gameName: project.game_names?.[0] ?? null,
    gameStartTime: project.clip_game_start_time ?? null,
  });
}
