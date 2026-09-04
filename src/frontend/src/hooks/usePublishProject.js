import { useState, useRef, useEffect, useCallback } from 'react';
import apiFetch from '../utils/apiFetch';
import { API_BASE } from '../config';
import { SECTION_NAMES } from '../config/displayNames';
import { useGalleryStore } from '../stores/galleryStore';
import { useQuestStore } from '../stores/questStore';
import { useProjectsStore } from '../stores/projectsStore';
import { toast } from '../components/shared/Toast';

/**
 * usePublishProject (T8530) — the single owner of the "Publish to Highlight Reels"
 * gesture, extracted verbatim from DraftTile.publishProject so the draft tile AND
 * the draft preview player (DraftReelPreview) share ONE publish path instead of
 * duplicating the T4050 durable-sync contract.
 *
 * T4050 contract carried through unchanged:
 * - POST /api/downloads/publish/{id}
 * - 503 sync_failed -> stash the gesture args in `publishRetry` (same gesture,
 *   one-click Retry), NO refetch, NO optimistic removal
 * - success -> fetchCount(force) + notifyCollectionsChanged() + fetchProjects(force)
 *   (card removal reflects backend state, never optimistic) + recordAchievement
 * - the [Publish] console tracing that correlates a real attempt with the backend
 *   [Publish]/[SYNC] lines
 *
 * Two deliberate changes vs the DraftTile original:
 * (a) generic failure surfaces a styled toast.error instead of the blunt alert()
 * (b) it is UNMOUNT-SAFE: side effects go through useXStore.getState()... (already
 *     the case), and only the setState calls are guarded by a mountedRef so a
 *     publish that resolves after the player/tile closed can't setState on an
 *     unmounted component. Close stays enabled during publish by design.
 *
 * @param {Object} project - the draft project ({ id } required)
 * The 503 path sets `publishRetry` (the T4050 stash). Generic failures surface a
 * toast only and do NOT set `publishRetry` — matching the DraftTile original, so
 * the board's Retry card (which reads publishRetry) keeps firing on 503 alone.
 * Surfaces that want an in-place retry on generic failure too (the player) drive
 * that from the promise result, not from this hook's state.
 *
 * @returns {{ publish: ({openGallery}) => Promise<boolean>, isPublishing: boolean,
 *            publishRetry: {openGallery:boolean}|null, setPublishRetry: Function }}
 *          `publish` resolves true on success, false on any failure (503 or generic).
 */
export function usePublishProject(project) {
  const [isPublishing, setIsPublishing] = useState(false);
  // T4050: when a durable publish fails to reach R2 (503 sync_failed), the surface
  // stays put and we stash the gesture args so the user can Retry the exact same
  // publish with one click (no refetch, no optimistic removal).
  const [publishRetry, setPublishRetry] = useState(null);

  // Unmount guard: the player/tile can close while a publish is in flight (Close
  // stays enabled). Side effects run through getState() (safe post-unmount); only
  // setState must be suppressed after unmount to avoid a React warning.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const publish = useCallback(async ({ openGallery }) => {
    if (mountedRef.current) setIsPublishing(true);
    // T4050 publish tracing: card removal is driven by fetchProjects re-reading
    // backend state below (NOT an optimistic local removal). These [Publish] logs
    // let a real publish attempt be traced end-to-end (click -> POST -> 200 ->
    // refetch) and correlated with the backend [Publish]/[SYNC] log lines.
    console.log(`[Publish] click project=${project.id} openGallery=${openGallery} -> POST publish`);
    try {
      const response = await apiFetch(`${API_BASE}/api/downloads/publish/${project.id}`, {
        method: 'POST',
      });
      // T4050: a durable sync failure means the publish committed locally but never
      // reached R2. Returning 200 would let fetchProjects remove the card while the
      // reel silently reverts on the next session. Keep the card, skip the refetch,
      // and surface Retry (same gesture) instead of the blunt alert.
      if (response.status === 503) {
        const error = await response.json().catch(() => ({}));
        if (error.code === 'sync_failed') {
          console.warn(`[Publish] project=${project.id} sync_failed (503) - card kept, offering Retry`);
          if (mountedRef.current) setPublishRetry({ openGallery });
          return false;
        }
      }
      if (!response.ok) {
        const error = await response.json();
        // Card is NOT removed on failure: we throw before fetchProjects, the catch
        // toasts, and the draft stays put.
        console.warn(`[Publish] project=${project.id} FAILED status=${response.status} - card kept in Drafts`);
        throw new Error(error.detail || 'Failed to publish');
      }
      const result = await response.json();
      if (mountedRef.current) setPublishRetry(null);
      console.log(`[Publish] project=${project.id} 200 ok archived=${result.archived} final_video_id=${result.final_video_id}`);
      if (!result.archived) {
        console.warn(`[ProjectCard] Project ${project.id} published but archive failed - card stays in Drafts.`);
      }
      // Model changed (a reel was published) -> update count badge + dispatch the
      // collections-changed event so the My Reels list refreshes itself.
      useGalleryStore.getState().fetchCount({ force: true });
      useGalleryStore.getState().notifyCollectionsChanged();
      console.log(`[Publish] project=${project.id} refetching projects (card removal reflects backend state)`);
      useProjectsStore.getState().fetchProjects({ force: true });
      // quest_4 "Move to My Reels" step — the publish gesture completes it.
      useQuestStore.getState().recordAchievement('moved_to_my_reels');
      if (openGallery) {
        useGalleryStore.getState().open();
      }
      return true;
    } catch (error) {
      console.error('[Publish] error:', error);
      // T8530: styled toast replaces the blunt alert() the DraftTile original used.
      // No publishRetry stash on generic failure (matching the original) — the
      // board card recovers via its own state; the player drives its amber retry
      // banner off this false return instead.
      toast.error('Could not publish', { message: error.message });
      return false;
    } finally {
      if (mountedRef.current) setIsPublishing(false);
    }
  }, [project.id]);

  return { publish, isPublishing, publishRetry, setPublishRetry };
}

// Re-export for callers that need the destination label.
export { SECTION_NAMES };
