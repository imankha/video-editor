import { useState, useEffect, useRef, useCallback } from 'react';
import { EyeOff, AlertTriangle } from 'lucide-react';
import { API_BASE } from '../config';
import { CollectionPlayer } from './collections/CollectionPlayer';
import { useReelPreviewStore } from '../stores/reelPreviewStore';
import { useQuestStore } from '../stores/questStore';
import { usePublishProject } from '../hooks/usePublishProject';
import { useWebShare } from '../hooks/useWebShare';
import { toast } from './shared/Toast';

/**
 * DraftReelPreview (T8530) — the thin, store-aware wrapper that turns an
 * unpublished draft into the SAME CollectionPlayer used everywhere else, plus the
 * publish gesture. CollectionPlayer stays strictly presentational; ALL publish/
 * share/draft vocabulary lives here (ui-spec §4.1).
 *
 * Opened via reelPreviewStore.open(snapshot) (finishedReelNav). The payload is a
 * snapshot that outlives the source project row, so this survives the post-publish
 * fetchProjects drop (ui-spec §4.2).
 *
 * State machine (ui-spec §4.6): Idle(draft) -> Publishing -> Success (banner
 * unmounts, primary slot swaps Publish->Share, toast.success, one-shot attention
 * ring on Share) -> 503/generic failure (amber retry banner, same gesture). Post-
 * publish coherence (§4.7): SAME final_video_id, the video does NOT reload — only
 * the banner/slot swap. `published` is a local flag driving the slot swap because
 * the archived project drops from the store.
 */
export function DraftReelPreview() {
  const payload = useReelPreviewStore((s) => s.payload);

  if (!payload) return null;
  // Key on the finalVideoId so a fresh open (a different reel) remounts and resets
  // the local publish/published state — but a publish of the SAME reel does NOT
  // change the key, so the video is never reloaded on publish (§4.7).
  return <DraftReelPreviewInner key={payload.finalVideoId} payload={payload} />;
}

function DraftReelPreviewInner({ payload }) {
  const close = useReelPreviewStore((s) => s.close);
  const { publish, isPublishing } = usePublishProject({ id: payload.projectId });
  const { copyLink, webShare, isMobile } = useWebShare();

  // Local publish state (the archived project drops from the store, so we can't
  // derive "published" from it — §4.6/§4.7).
  const [published, setPublished] = useState(false);
  const [failed, setFailed] = useState(false);
  const [ringOn, setRingOn] = useState(false);
  const ringTimer = useRef(null);
  useEffect(() => () => clearTimeout(ringTimer.current), []);

  // T8535 (moved from DraftTile, T6840 origin): quest_4 "Watch Your Preview"
  // fires after ~1s of preview playback, mirroring watched_gallery_video_1s so
  // opening and instantly closing (or scrubbing past) doesn't count. This
  // component remounts fresh per open (keyed on finalVideoId by the parent), so
  // a mount-scoped timer is a correct one-shot-per-open watch timer; unmounting
  // before ~1s (closing the player) cancels it via the cleanup below.
  useEffect(() => {
    const timer = setTimeout(() => {
      useQuestStore.getState().recordAchievement('previewed_draft_reel_1s');
    }, 1000);
    return () => clearTimeout(timer);
  }, []);

  // One-reel payload for CollectionPlayer, mirroring the playerReels shape. The
  // draft's final video streams from the same endpoint a published reel uses
  // (the stream endpoint is not gated on published_at), so publish never changes
  // the src — the identity (final_video_id) is stable across publish (§4.7).
  const reels = [
    {
      id: payload.finalVideoId,
      name: payload.name,
      streamUrl: `${API_BASE}/api/downloads/${payload.finalVideoId}/stream`,
      aspect_ratio: payload.aspectRatio,
      duration: null,
      clip_count: payload.clipCount,
      gameName: payload.gameName ?? null,
      gameStartTime: payload.gameStartTime ?? null,
    },
  ];

  const handlePublish = useCallback(async () => {
    setFailed(false);
    const ok = await publish({ openGallery: false });
    if (ok) {
      setPublished(true);
      toast.success('Published', { message: 'Anyone with the link can watch it.' });
      // One-shot attention ring on the freshly-swapped Share button (§4.6).
      setRingOn(true);
      clearTimeout(ringTimer.current);
      ringTimer.current = setTimeout(() => setRingOn(false), 1500);
    } else {
      // 503 sync_failed AND generic failure both land here: show the amber retry
      // banner in place (§4.6). The hook already toasted the generic-failure error.
      setFailed(true);
    }
  }, [publish]);

  // Share only appears AFTER publish (published state). ~15-line wiring per §4.5:
  // coarse pointer -> native share sheet; fine pointer -> copy link + toast. Same
  // split DownloadsPanel.sharePlayerReel uses.
  const handleShare = useCallback(async (reel) => {
    try {
      if (isMobile) {
        const method = await webShare({
          downloadId: reel.id,
          title: reel.name || 'Highlight Reel',
          text: `Check out ${reel.name || 'this highlight reel'}!`,
          filename: `${reel.name || 'highlight'}-highlight.mp4`,
        });
        if (method === 'clipboard') {
          toast.success('Link copied to clipboard', { dedupKey: 'copy-link' });
        }
      } else {
        await copyLink({ downloadId: reel.id });
        toast.success('Link copied to clipboard', { dedupKey: 'copy-link' });
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
      toast.error('Share failed', { message: err.message });
    }
    // First interaction clears the attention ring (§4.6).
    setRingOn(false);
    clearTimeout(ringTimer.current);
  }, [isMobile, webShare, copyLink]);

  // Status banner: cyan draft strip (idle/publishing) -> amber retry surface on
  // failure -> nothing once published (§4.4/§4.6). Copy on the amber strip matches
  // DraftTile's retry card exactly ("Couldn't save to the cloud.") so the two
  // surfaces read as one system.
  let statusBanner = null;
  if (published) {
    statusBanner = null;
  } else if (failed) {
    statusBanner = (
      <div
        data-testid="draft-preview-banner"
        className="flex items-center gap-2 px-3 py-1.5 border-y border-amber-900/40 bg-amber-950/30 text-amber-200 text-xs"
        role="alert"
      >
        <AlertTriangle size={14} className="shrink-0" aria-hidden="true" />
        <span className="min-w-0">Couldn&apos;t save to the cloud.</span>
        <button
          type="button"
          onClick={handlePublish}
          disabled={isPublishing}
          className="ml-auto shrink-0 px-3 py-1 rounded-md text-[11px] font-medium border border-amber-500 text-amber-300 hover:bg-amber-900/30 disabled:opacity-50"
        >
          Retry
        </button>
      </div>
    );
  } else {
    statusBanner = (
      <div
        data-testid="draft-preview-banner"
        className="flex items-center gap-2 px-3 py-1.5 border-y border-cyan-900/40 bg-cyan-950/30 text-cyan-200 text-xs"
      >
        <EyeOff size={14} className="shrink-0" aria-hidden="true" />
        <span className="min-w-0">
          {isPublishing
            ? 'Publishing...'
            : 'Only you can see this. Publish it to get a share link.'}
        </span>
      </div>
    );
  }

  return (
    <CollectionPlayer
      reels={reels}
      title={payload.name}
      onClose={close}
      statusBanner={statusBanner}
      // Primary slot is state-exclusive: Publish in the draft state, Share once
      // published. Passing only one keeps CollectionPlayer's render gate simple.
      onPublish={published ? undefined : handlePublish}
      publishLoading={isPublishing}
      onShare={published ? handleShare : undefined}
      shareRing={ringOn}
    />
  );
}

export default DraftReelPreview;
