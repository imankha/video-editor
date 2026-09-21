import { useState, useEffect, useRef, useCallback } from 'react';
import { EyeOff, AlertTriangle } from 'lucide-react';
import { API_BASE } from '../config';
import { CollectionPlayer } from './collections/CollectionPlayer';
import { PublishLinkFlow } from './PublishLinkFlow';
import { useReelPreviewStore } from '../stores/reelPreviewStore';
import { useEditorStore, EDITOR_MODES } from '../stores/editorStore';
import { useQuestStore } from '../stores/questStore';
import { usePublishProject } from '../hooks/usePublishProject';
import { useWebShare } from '../hooks/useWebShare';
import { useDownloads } from '../hooks/useDownloads';
import { toast } from './shared/Toast';
import { setPendingGame } from '../utils/pendingNavigation';

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
 * T10180 (design doc): the old two-flag (published/failed) one-tap publish->share
 * swap is replaced by an explicit `phase` state machine — idle -> review
 * (visibility-review confirm, no write yet) -> publishing (the write gesture:
 * publish() then createShareLink()) -> ready (link-ready, selectable readonly
 * input + Copy) / failed (amber retry, same gesture). The whole flow renders via
 * `PublishLinkFlow` into CollectionPlayer's `actionBar` slot — the old
 * state-exclusive onPublish/onShare primary slot is no longer used here (design
 * §2.1/R2). `statusBanner` still carries the cyan idle / amber failed strip; the
 * primary buttons live in `actionBar` now.
 */
export function DraftReelPreview() {
  const payload = useReelPreviewStore((s) => s.payload);
  const close = useReelPreviewStore((s) => s.close);
  const editorMode = useEditorStore((s) => s.editorMode);

  // T9470: scope the fullscreen overlay to the screen it was opened on. The
  // preview is a single top-level mount (rendered on BOTH the home and editor
  // returns in App.jsx), and its payload is a snapshot that outlives navigation.
  // Without scoping, clicking Preview on the drafts (home) screen and then
  // navigating into an editor screen before the video finished loading surfaced
  // the player late OVER that unrelated screen. `openMode` is stamped by
  // finishedReelNav at open time (always PROJECT_MANAGER); once the live editor
  // mode moves off it, the user has navigated away, so we discard the snapshot.
  // The render guard below prevents any one-frame flash; this effect clears the
  // now-orphaned snapshot from the store so it can never re-surface. A payload
  // with no openMode (legacy/dev diag direct-open) is never treated as off-page.
  const offPage = payload != null && payload.openMode != null && payload.openMode !== editorMode;
  useEffect(() => {
    if (offPage) close();
  }, [offPage, close]);

  if (!payload || offPage) return null;
  // Key on the finalVideoId so a fresh open (a different reel) remounts and resets
  // the local phase state — but a publish of the SAME reel does NOT change the
  // key, so the video is never reloaded on publish (§4.7). A repeat click on the
  // SAME draft rebuilds an equivalent snapshot with the same finalVideoId, so the
  // player is not remounted and no duplicate request fires.
  return <DraftReelPreviewInner key={payload.finalVideoId} payload={payload} />;
}

function DraftReelPreviewInner({ payload }) {
  const close = useReelPreviewStore((s) => s.close);
  const { publish, isPublishing } = usePublishProject({ id: payload.projectId });
  const { copyLink, webShare, createShareLink, isMobile } = useWebShare();
  const { downloadFile, downloadingId } = useDownloads();

  // Phase state machine (design §2.2/§3.3): idle -> review -> publishing ->
  // ready | failed. T8390: seeds 'idle' with link-ready CAPABILITY when the
  // caller already ran the publish gesture before opening this preview (Focus's
  // one-tap Publish) — 'ready-capable' reaches link-ready via a first Get-link
  // click WITHOUT auto-creating the link on mount (R5: no reactive effect fires
  // a network call). alreadyPublished never seeds 'review' or 'publishing'.
  const [phase, setPhase] = useState(payload.alreadyPublished ? 'ready-capable' : 'idle');
  const [shareUrl, setShareUrl] = useState(null);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef(null);
  useEffect(() => () => clearTimeout(copiedTimer.current), []);

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

  // T10190 §3.2 Shaper 2: "Back to game plays" backlink, gated on the snapshot
  // resolving exactly one source game (payload.gameId, fed by finishedReelNav).
  // Gesture -> handler -> setPendingGame + setEditorMode(ANNOTATE), the same
  // gesture-driven primitives App.jsx's handleEditInAnnotate uses. No reactive
  // effect. payload.sourceClipId is intentionally undefined on this (library/
  // one-tap) path -- the project-list-item shape finishedReelNav snapshots from
  // carries no raw_clip_id/source_clip_id, unlike Focus/Overlay which hold the
  // selected clip directly. setPendingGame tolerates a missing clip id (lands
  // on the right game+clock, skips T3960 clip re-selection).
  const handleBackToGame = useCallback(() => {
    setPendingGame(payload.gameId, payload.gameStartTime, payload.sourceClipId);
    useEditorStore.getState().setEditorMode(EDITOR_MODES.ANNOTATE);
  }, [payload.gameId, payload.gameStartTime, payload.sourceClipId]);

  // "Publish and get link" click: pure UI transition, NO write (design §2.2).
  const handlePublishClick = useCallback(() => {
    setPhase('review');
  }, []);

  // "Cancel" click: back to idle, no write ever occurred.
  const handleCancelReview = useCallback(() => {
    setPhase('idle');
  }, []);

  // "Publish and create link" click — the single write gesture: publish() then
  // createShareLink(), entirely inside this onClick chain (CLAUDE.md gesture-
  // based persistence rule; never a useEffect).
  const handleConfirmPublish = useCallback(async () => {
    setPhase('publishing');
    const ok = await publish({ openGallery: false });
    if (!ok) {
      // 503 sync_failed AND generic failure both land here: amber retry banner
      // in place (§4.6). The hook already toasted the generic-failure error.
      setPhase('failed');
      return;
    }
    const url = await createShareLink({ downloadId: payload.finalVideoId });
    setShareUrl(url);
    setPhase('ready');
  }, [publish, createShareLink, payload.finalVideoId]);

  // A 'ready-capable' (alreadyPublished) preview mints the link on the FIRST
  // Get-link click — never on mount (R5). Once minted it behaves exactly like a
  // freshly-published 'ready' phase.
  const handleGetLinkCapable = useCallback(async () => {
    const url = await createShareLink({ downloadId: payload.finalVideoId });
    setShareUrl(url);
    setPhase('ready');
  }, [createShareLink, payload.finalVideoId]);

  // Copy click (fine pointer, ready phase): await clipboard success before
  // toasting (R7 — no false "copied" before the write lands); LinkReadyCard's
  // selectable input is the visible fallback for the no-clipboard-API case.
  const handleCopy = useCallback(async () => {
    try {
      await copyLink({ downloadId: payload.finalVideoId });
      toast.success('Link copied to clipboard', { dedupKey: 'copy-link' });
      setCopied(true);
      clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      toast.error('Copy failed', { message: err.message });
    }
  }, [copyLink, payload.finalVideoId]);

  // "Share link..." click (coarse pointer, ready phase): existing useWebShare
  // native-share path.
  const handleNativeShare = useCallback(async () => {
    try {
      const method = await webShare({
        downloadId: payload.finalVideoId,
        title: payload.name || 'Highlight Reel',
        text: `Check out ${payload.name || 'this highlight reel'}!`,
        filename: `${payload.name || 'highlight'}-highlight.mp4`,
      });
      if (method === 'clipboard') {
        toast.success('Link copied to clipboard', { dedupKey: 'copy-link' });
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
      toast.error('Share failed', { message: err.message });
    }
  }, [webShare, payload.finalVideoId, payload.name]);

  const handleDownload = useCallback(async (reel) => {
    try {
      await downloadFile(reel.id);
    } catch (err) {
      toast.error('Download failed', { message: err.message });
    }
  }, [downloadFile]);

  // Status banner: cyan draft strip (idle/publishing) -> amber retry surface on
  // failure -> nothing once a link exists or capability is already published
  // (§4.4/§4.6). Copy on the amber strip matches DraftTile's retry card exactly
  // ("Couldn't save to the cloud.") so the two surfaces read as one system.
  let statusBanner = null;
  if (phase === 'failed') {
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
          onClick={handleConfirmPublish}
          disabled={isPublishing}
          className="ml-auto shrink-0 px-3 py-1 rounded-md text-[11px] font-medium border border-amber-500 text-amber-300 hover:bg-amber-900/30 disabled:opacity-50"
        >
          Retry
        </button>
      </div>
    );
  } else if (phase === 'idle' || phase === 'review' || phase === 'publishing') {
    statusBanner = (
      <div
        data-testid="draft-preview-banner"
        className="flex items-center gap-2 px-3 py-1.5 border-y border-cyan-900/40 bg-cyan-950/30 text-cyan-200 text-xs"
      >
        <EyeOff size={14} className="shrink-0" aria-hidden="true" />
        <span className="min-w-0">
          {phase === 'publishing'
            ? 'Publishing...'
            : 'Only you can see this. Publish it to get a share link.'}
        </span>
      </div>
    );
  }
  // 'ready' and 'ready-capable' (before first Get-link click): no banner.

  // actionBar: the whole publish->review->link-ready flow. 'ready-capable'
  // (alreadyPublished, no link minted yet) reuses the 'ready' phase render with
  // a null shareUrl, whose LinkReadyCard shows the Get-link trigger
  // (onGetLink) instead of the selectable input — so the FIRST link-producing
  // gesture is that click, never a mount effect (R5).
  const flowPhase = phase === 'ready-capable' ? 'ready' : phase;
  const actionBar = (
    <PublishLinkFlow
      phase={flowPhase}
      reelName={payload.name}
      shareUrl={phase === 'ready-capable' ? null : shareUrl}
      isMobile={isMobile}
      copied={copied}
      onPublishClick={handlePublishClick}
      onCancel={handleCancelReview}
      onConfirm={handleConfirmPublish}
      onCopy={handleCopy}
      onNativeShare={phase === 'ready-capable' ? handleGetLinkCapable : handleNativeShare}
      onGetLink={handleGetLinkCapable}
    />
  );

  return (
    <CollectionPlayer
      reels={reels}
      title={payload.name}
      onClose={close}
      statusBanner={statusBanner}
      actionBar={actionBar}
      onDownload={handleDownload}
      downloadLoading={downloadingId === payload.finalVideoId}
      onBackToGame={payload.gameId != null ? handleBackToGame : undefined}
    />
  );
}

export default DraftReelPreview;
