import { useCallback, useRef, useState } from 'react';
import { API_BASE } from '../config';
import apiFetch from '../utils/apiFetch';
import { toast } from '../components/shared/Toast';
import { track } from '../utils/analytics';

/**
 * useMoveReels - T4850: move published reels to a sibling profile of the same user.
 *
 * One explicit gesture -> one surgical POST /api/downloads/move-to-profile with the
 * selected ids + target profile. No reactive persistence. On success the caller
 * refreshes My Reels (moved reels disappear from the source view).
 *
 * T6350: the move is multi-phase — the TARGET copy is written+synced durably FIRST,
 * then the SOURCE rows are removed. If the SOURCE-side durable sync fails AFTER the
 * target is committed, the reels were genuinely COPIED but not yet removed here. The
 * backend now reports that honestly (`code === 'move_source_cleanup_failed'`) instead
 * of the old "not moved" lie; we surface a non-dismissing toast with a "Finish
 * removing" action that hits the idempotent /move-to-profile/finish endpoint, and we
 * report the partial state to the caller via `onPartial` WITHOUT firing `onMoved`
 * (the move is not finished from the user's perspective).
 *
 * @param {(movedIds:number[], targetProfileId:string)=>void} onMoved   - full-success cb
 * @param {(movedIds:number[], targetProfileId:string)=>void} [onPartial] - copied-but-not-removed cb
 */
export function useMoveReels(onMoved, onPartial) {
  const [moving, setMoving] = useState(false);
  // finishMove and its retry toast reference each other; a ref breaks the cycle so
  // the toast action always calls the latest finishMove.
  const finishMoveRef = useRef(null);

  const showCleanupFailedToast = useCallback((videoIds, targetProfileId) => {
    toast.error('Reels only partly moved', {
      message:
        'They were copied to the other profile but not removed from here. ' +
        'Finish removing them?',
      duration: 0, // sticky — the user must act (or dismiss)
      action: {
        label: 'Finish removing',
        onClick: () => finishMoveRef.current?.(videoIds, targetProfileId),
      },
    });
  }, []);

  // Re-run ONLY the source cleanup (idempotent). Used by the "Finish removing"
  // action after a partial move; on success the reels truly leave this profile.
  const finishMove = useCallback(async (videoIds, targetProfileId) => {
    if (!videoIds?.length || !targetProfileId) return false;
    try {
      const res = await apiFetch(`${API_BASE}/api/downloads/move-to-profile/finish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ video_ids: videoIds, target_profile_id: targetProfileId }),
      });

      if (res.status === 503) {
        const err = await res.json().catch(() => ({}));
        if (err?.detail?.code === 'move_source_cleanup_failed' || err?.code === 'move_source_cleanup_failed') {
          showCleanupFailedToast(videoIds, targetProfileId);
          return false;
        }
      }

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const detail = err?.detail;
        const msg = typeof detail === 'string' ? detail : (detail?.message || 'Could not finish removing');
        toast.error(msg);
        return false;
      }

      toast.success('Finished removing', {
        message: 'The reels now live only in the other profile.',
      });
      onMoved?.(videoIds, targetProfileId);
      return true;
    } catch (err) {
      console.error('[useMoveReels] finishMove error:', err);
      toast.error('Could not finish removing');
      return false;
    }
  }, [onMoved, showCleanupFailedToast]);
  finishMoveRef.current = finishMove;

  const moveReels = useCallback(async (videoIds, targetProfileId) => {
    if (!videoIds?.length || !targetProfileId) return false;
    setMoving(true);
    try {
      const res = await apiFetch(`${API_BASE}/api/downloads/move-to-profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ video_ids: videoIds, target_profile_id: targetProfileId }),
      });

      if (res.status === 503) {
        const err = await res.json().catch(() => ({}));
        const code = err?.detail?.code || err?.code;
        // T6350: the target copy IS durable — check this BEFORE the generic
        // sync_failed branch so we never show the old "not moved" lie.
        if (code === 'move_source_cleanup_failed') {
          showCleanupFailedToast(videoIds, targetProfileId);
          onPartial?.(videoIds, targetProfileId);
          return { partial: true };
        }
        if (code === 'sync_failed') {
          toast.error('Could not save to the cloud', {
            message: 'Your reels were not moved. Please try again.',
          });
          return false;
        }
      }

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const detail = err?.detail;
        const msg = typeof detail === 'string' ? detail : (detail?.message || 'Could not move reels');
        toast.error(msg);
        return false;
      }

      const data = await res.json();
      track('reels_moved', { count: data.moved_ids?.length || videoIds.length });
      toast.success(
        videoIds.length > 1 ? `Moved ${videoIds.length} reels` : 'Reel moved',
        { message: 'Find them in the other profile’s Highlight Reels.' },
      );
      onMoved?.(data.moved_ids || videoIds, targetProfileId);
      return true;
    } catch (err) {
      console.error('[useMoveReels] moveReels error:', err);
      toast.error('Could not move reels');
      return false;
    } finally {
      setMoving(false);
    }
  }, [onMoved, onPartial, showCleanupFailedToast]);

  return { moveReels, finishMove, moving };
}

export default useMoveReels;
