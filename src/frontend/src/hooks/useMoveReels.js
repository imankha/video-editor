import { useState, useCallback } from 'react';
import { API_BASE } from '../config';
import apiFetch from '../utils/apiFetch';
import { toast } from '../components/shared/Toast';
import { track } from '../utils/analytics';

/**
 * useMoveReels - T4850: move published reels to a sibling profile of the same user.
 *
 * One explicit gesture -> one surgical POST /api/downloads/move-to-profile with the
 * selected ids + target profile. No reactive persistence. On success the caller
 * refreshes My Reels (moved reels disappear from the source view). Durable-sync
 * failure (503) keeps the reels in place and surfaces a retryable message — the
 * source is never optimistically emptied.
 *
 * @param {(movedIds:number[], targetProfileId:string)=>void} onMoved - success cb
 */
export function useMoveReels(onMoved) {
  const [moving, setMoving] = useState(false);

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
        if (err?.detail?.code === 'sync_failed' || err?.code === 'sync_failed') {
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
        { message: 'Find them in the other profile’s My Reels.' },
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
  }, [onMoved]);

  return { moveReels, moving };
}

export default useMoveReels;
