import { useState, useRef, useEffect, useCallback } from 'react';
import apiFetch from '../utils/apiFetch';
import { API_BASE } from '../config';
import { SECTION_NAMES } from '../config/displayNames';
import { useGalleryStore } from '../stores/galleryStore';
import { useQuestStore } from '../stores/questStore';
import { useProjectsStore } from '../stores/projectsStore';
import { toast } from '../components/shared/Toast';

/**
 * usePublishProject (T8530) — the single owner of the publish gesture (files the
 * project under SECTION_NAMES.PUBLISHED), extracted verbatim from
 * DraftTile.publishProject so the draft tile AND the draft preview player
 * (DraftReelPreview) share ONE publish path instead of duplicating the T4050
 * durable-sync contract.
 *
 * T4050 contract carried through unchanged:
 * - POST /api/downloads/publish/{id}
 * - 503 sync_failed -> stash the gesture args in `publishRetry` (same gesture,
 *   one-click Retry), NO refetch, NO optimistic removal
 * - success -> fetchCount(force) + notifyCollectionsChanged() + fetchProjects(force)
 *   (card removal reflects backend state, never optimistic) + recordAchievement
 *   + galleryStore.setJustPublished (T11580 Published-tab spotlight card)
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

  // T9740 (fix v3): accept an explicit `projectId` override. App.jsx's one-tap
  // publish reads the target from the completion payload itself, not from this
  // hook's `project.id` binding — that binding comes from a reactive
  // publishIntentStore selector inside a callback the export-websocket manager
  // holds from export start, i.e. exactly the stale-closure-over-time construct
  // that has bitten this task. `targetId` falls back to `project.id` so every
  // existing caller (DraftTile, DraftReelPreview) is unchanged.
  const publish = useCallback(async ({ openGallery, projectId } = {}) => {
    const targetId = projectId ?? project.id;
    if (mountedRef.current) setIsPublishing(true);
    // T4050 publish tracing: card removal is driven by fetchProjects re-reading
    // backend state below (NOT an optimistic local removal). These [Publish] logs
    // let a real publish attempt be traced end-to-end (click -> POST -> 200 ->
    // refetch) and correlated with the backend [Publish]/[SYNC] log lines.
    console.log(`[Publish] click project=${targetId} openGallery=${openGallery} -> POST publish`);
    try {
      const response = await apiFetch(`${API_BASE}/api/downloads/publish/${targetId}`, {
        method: 'POST',
      });
      // T4050: a durable sync failure means the publish committed locally but never
      // reached R2. Returning 200 would let fetchProjects remove the card while the
      // reel silently reverts on the next session. Keep the card, skip the refetch,
      // and surface Retry (same gesture) instead of the blunt alert.
      if (response.status === 503) {
        const error = await response.json().catch(() => ({}));
        if (error.code === 'sync_failed') {
          console.warn(`[Publish] project=${targetId} sync_failed (503) - card kept, offering Retry`);
          if (mountedRef.current) setPublishRetry({ openGallery });
          return false;
        }
      }
      if (!response.ok) {
        const error = await response.json();
        // Card is NOT removed on failure: we throw before fetchProjects, the catch
        // toasts, and the draft stays put.
        console.warn(`[Publish] project=${targetId} FAILED status=${response.status} - card kept in Drafts`);
        throw new Error(error.detail || 'Failed to publish');
      }
      const result = await response.json();
      if (mountedRef.current) setPublishRetry(null);
      console.log(`[Publish] project=${targetId} 200 ok archived=${result.archived} final_video_id=${result.final_video_id}`);
      if (!result.archived) {
        console.warn(`[ProjectCard] Project ${targetId} published but archive failed - card stays in Drafts.`);
      }
      // T11580: spotlight the highlight that was JUST published (gesture-scoped,
      // memory-only -- see galleryStore.setJustPublished). gameId/aspectRatio
      // come from the PUBLISH RESPONSE itself (server-computed, at the exact
      // moment of publish), NOT a client-side projectsStore snapshot -- a real
      // live-verification bug (2026-10-02) found the client cache's game_ids
      // stale relative to server truth (a single-game highlight resolved to
      // gameId: null and auto-expanded Mixes instead of its real game group).
      //
      // `collection_game_id` is the backend's ACTUAL ROUTING DECISION (same
      // route_collection() rule list_downloads/collections_summary use on the
      // FROZEN final_videos.game_ids/clip_count) -- a single game id, or null
      // for Mixes -- not a raw game_ids list the frontend re-gates itself. An
      // earlier version of this fix sent a raw game_ids list re-derived via a
      // fresh working_clips join that ignored clip_count entirely, so a
      // multi-clip highlight from ONE game wrongly targeted that game's group
      // instead of Mixes (list_downloads routes any clip_count != 1 reel to
      // Mixes regardless of game count) -- caught by an independent
      // proof-verifier pass. Reading the backend's own routing decision
      // directly eliminates that whole class of disagreement.
      //
      // `result.collection_game_id` is undefined (never null) on an older
      // backend during a rolling deploy (response shape predates T11580) --
      // guarded so a skew window degrades to "skip the spotlight", never a
      // guessed/wrong game. Still isolated in its own try/catch (defense in
      // depth, unrelated failure modes) so it can never take down the
      // critical effects below (fetchCount/notifyCollectionsChanged/
      // fetchProjects/recordAchievement), which must run unconditionally on
      // every successful publish (Branch CI run 37040668288 caught a prior
      // version of this sharing the outer catch).
      try {
        if (result.collection_game_id !== undefined && result.aspect_ratio) {
          useGalleryStore.getState().setJustPublished({
            finalVideoId: result.final_video_id,
            gameId: result.collection_game_id,
            aspectRatio: result.aspect_ratio,
          });
        } else {
          console.warn(`[Publish] project=${targetId} publish response missing collection_game_id/aspect_ratio (older backend?) - skipping justPublished spotlight`);
        }
      } catch (spotlightError) {
        console.error('[Publish] justPublished spotlight failed (non-fatal, publish still succeeded):', spotlightError);
      }
      // Model changed (a reel was published) -> update count badge + dispatch the
      // collections-changed event so the My Reels list refreshes itself.
      useGalleryStore.getState().fetchCount({ force: true });
      useGalleryStore.getState().notifyCollectionsChanged();
      console.log(`[Publish] project=${targetId} refetching projects (card removal reflects backend state)`);
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
      toast.error('Could not finish', { message: error.message });
      return false;
    } finally {
      if (mountedRef.current) setIsPublishing(false);
    }
  }, [project.id]); // targetId falls back to project.id; an explicit override is a call arg, not a dep

  return { publish, isPublishing, publishRetry, setPublishRetry };
}

// Re-export for callers that need the destination label.
export { SECTION_NAMES };
