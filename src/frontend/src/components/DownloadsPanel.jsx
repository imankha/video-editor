import { useState, useEffect, useRef, useCallback } from 'react';
import { X, Image } from 'lucide-react';
import { ShareModal } from './ShareModal';
import { CollectionShareModal } from './CollectionShareModal';
import { MoveToProfileModal } from './MoveToProfileModal';
import { Button } from './shared/Button';
import { CollectionsTab } from './collections/CollectionsTab';
import { ReelTile } from './collections/ReelTile';
import { CollectionPlayer } from './collections/CollectionPlayer';
import { ConfidenceBanner } from './ranking/ConfidenceBanner';
import { RankingGame } from './ranking/RankingGame';
import { toPlayerReel } from './collections/playerReels';
import { useReEditReel } from '../hooks/useReEditReel';
import { useDownloads } from '../hooks/useDownloads';
import { useCollections } from '../hooks/useCollections';
import { useMoveReels } from '../hooks/useMoveReels';
import { useProfileStore } from '../stores/profileStore';
import { formatDurationHuman } from './collections/format';
import { useWebShare } from '../hooks/useWebShare';
import { useGalleryStore } from '../stores/galleryStore';
import { SourceType } from '../constants/sourceTypes';
import { useQuestStore } from '../stores/questStore';
import { setWarmupPriority, WARMUP_PRIORITY } from '../utils/cacheWarming';
import { toast } from './shared/Toast';
import { track } from '../utils/analytics';
import { API_BASE } from '../config';
import apiFetch from '../utils/apiFetch';
import { SECTION_NAMES } from '../config/displayNames';
import { REEL } from '../config/themeColors';
import { formatGameClock } from '../utils/timeFormat';

/**
 * DownloadsPanel - Slide-out panel for managing final video downloads
 *
 * Features:
 * - Lists all final videos grouped by date
 * - Each item shows: project name, filename, date, file size
 * - Actions: Download to local, Open project, Delete
 *
 * Race-safe:
 * - Uses useDownloads hook with AbortController
 * - Shows loading skeleton while fetching
 * - Guards against stale state updates
 */
export function DownloadsPanel({
  onOpenProject,  // (projectId) => void - Navigate to project
}) {
  // Gallery state from store
  const isOpen = useGalleryStore((state) => state.isOpen);
  const close = useGalleryStore((state) => state.close);
  // Header chip = NEW (unwatched) reels, matching the home "My Reels" badge so the
  // same number appears in both places. galleryStore is the source of truth (the
  // full reel list is not fetched on open); the count derives from watched_at and
  // decrements as reels are watched (T3900).
  const unseenReelsCount = useGalleryStore((state) => state.unwatchedCount);

  // useDownloads supplies the per-reel action helpers + formatters. The full-list
  // fetch is disabled (false) — the single view sources members from
  // useCollections, not this list (T3610 §0B.1). `downloads` stays [].
  const {
    downloads,
    deleteDownload,
    downloadFile,
    downloadingId,
    renameDownload,
    markWatched,
    formatDate,
  } = useDownloads(false);

  // Collections data, lifted here so per-reel mutations can keep the member
  // lists honest (T3610 §0B.6).
  const collections = useCollections(isOpen);

  // Shared story player — one player for both single reels and collections
  // (T3610). { reels, title, downloadId? }. Rendered at the panel top level so
  // it fills the viewport (the drawer's transform would otherwise confine it).
  const [storyPlayer, setStoryPlayer] = useState(null);
  const watchTimerRef = useRef(null);
  // Reels already marked watched in the current player session — avoids redundant
  // PATCH/recompute calls when the user navigates back and forth (T3900).
  const watchedThisSessionRef = useRef(new Set());

  const onPlayCollection = (reels, title) => {
    watchedThisSessionRef.current.clear();
    setStoryPlayer({ reels, title });
  };
  const closeStoryPlayer = useCallback(() => { clearTimeout(watchTimerRef.current); setStoryPlayer(null); }, []);

  // Single source of watched-marking for BOTH the single-reel and collection
  // playback paths: the player fires onReelChange when a reel becomes active
  // (on mount and on each advance). Mark it watched -> PATCH the DB ->
  // galleryStore recomputes the badge (T3900). Idempotent on the server, so the
  // session set is purely a redundant-call guard.
  const handleReelWatched = useCallback((_index, reel) => {
    if (!reel?.id || watchedThisSessionRef.current.has(reel.id)) return;
    watchedThisSessionRef.current.add(reel.id);
    markWatched(reel.id);
    collections.patchMember(reel.id, { watched_at: new Date().toISOString() });
  }, [markWatched, collections]);

  // State for before/after export
  const [exportingBeforeAfter, setExportingBeforeAfter] = useState(null);

  // T3940: one restore-then-navigate path shared by the My Reels card, the in-player
  // Re-edit button, and the ranker replay. Navigation = open the editor (T66 restore
  // resumes Framing) + close the gallery + tear down the story player if it's open.
  const navigateToProject = useCallback((projectId) => {
    onOpenProject?.(projectId);
    close();
    closeStoryPlayer();
  }, [onOpenProject, close, closeStoryPlayer]);
  const { openReelAsProject, restoringId } = useReEditReel(navigateToProject);

  // T4030: author re-ranks a reel while watching it. The tap is the only write
  // trigger (gesture-only): POST /api/rank/reopen re-opens the reel for ranking
  // (rd reset, match_count -> 0, rating untouched, twin-synced server-side) so it
  // re-enters the game and the Confidence banner % drops on next read.
  const [reRankingId, setReRankingId] = useState(null);
  const handleReRank = useCallback(async (reel) => {
    if (!reel?.id) return;
    setReRankingId(reel.id);
    try {
      const res = await apiFetch(`${API_BASE}/api/rank/reopen`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ final_video_id: reel.id }),
      });
      if (!res.ok) throw new Error(`reopen failed (${res.status})`);
      toast.success("We'll re-rank this one", {
        message: 'It re-enters the ranking game so its spot can move.',
      });
      setRankRefreshKey((k) => k + 1); // banner refetches the dropped %
    } catch {
      toast.error('Could not re-rank this reel');
    } finally {
      setReRankingId(null);
    }
  }, []);

  // State for share modal
  const [sharingDownload, setSharingDownload] = useState(null);

  // T3620: collection share modal ({ definition, title }) + one-tap copy link.
  const [sharingCollection, setSharingCollection] = useState(null);

  // T3630: ranking game (pairwise Glicko). Opened from the ConfidenceBanner.
  // On close we bump a key so the banner refetches and re-sort cached members
  // into the new rating order (read-only; the writes happened via the game).
  const [showRankingGame, setShowRankingGame] = useState(false);
  const [rankRefreshKey, setRankRefreshKey] = useState(0);
  const closeRankingGame = () => {
    setShowRankingGame(false);
    setRankRefreshKey((k) => k + 1);
    collections.resortMembers();
  };

  const onShareCollection = (definition, title) => setSharingCollection({ definition, title });

  const onCopyCollectionLink = async (definition) => {
    try {
      const resp = await apiFetch(`${API_BASE}/api/collections/share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ definition, recipient_emails: [], is_public: true }),
      });
      if (!resp.ok) throw new Error(`Failed (${resp.status})`);
      const data = await resp.json();
      const token = data.shares?.[0]?.share_token;
      if (!token) throw new Error('No link returned');
      const url = `${window.location.origin}/shared/collection/${token}`;
      try {
        await navigator.clipboard.writeText(url);
      } catch {
        const input = document.createElement('input');
        input.value = url;
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        document.body.removeChild(input);
      }
      toast.success('Public link copied', {
        message: 'Anyone with the link can watch these highlights.',
      });
    } catch {
      toast.error('Could not create link');
    }
  };

  // T4850/T5678: move a reel to a sibling profile (multi-athlete accounts). The
  // per-reel "Move to profile…" action is hidden unless the account has 2+
  // profiles (there is nowhere to move a reel otherwise). Batch select mode was
  // removed in T5678 — moves are one-reel-at-a-time from the card's kebab menu.
  const profiles = useProfileStore((state) => state.profiles);
  const currentProfileId = useProfileStore((state) => state.currentProfileId);
  const otherProfiles = profiles.filter((p) => p.id !== currentProfileId);
  const canMoveProfiles = profiles.length >= 2;

  // Ids currently targeted by the Move-to-profile modal (a single-reel list).
  const [movingIds, setMovingIds] = useState(null);

  // A stale in-flight move target is source-profile-scoped; drop it if the active
  // profile changes while the panel is mounted (resets local UI only — NOT a
  // reactive persistence write).
  useEffect(() => {
    setMovingIds(null);
  }, [currentProfileId]);

  // Success handler for a completed move: the reels left this profile, so drop
  // them from the cached member lists, refresh the summary + NEW badge, and close
  // the picker. Gesture-driven refresh only — no reactive persistence.
  const onReelsMoved = useCallback((movedIds) => {
    movedIds.forEach((id) => collections.removeMember(id));
    collections.fetchSummary();
    useGalleryStore.getState().fetchCount({ force: true });
    setMovingIds(null);
  }, [collections]);

  const { moveReels, moving } = useMoveReels(onReelsMoved);

  // Native share support
  const { isMobile, copyLink, webShare } = useWebShare();

  if (!isOpen && !storyPlayer) return null;

  const handleDelete = async (e, download) => {
    e.stopPropagation();
    if (window.confirm(`Delete "${download.filename}"?`)) {
      await deleteDownload(download.id, true);
      // Keep the collection member lists + aggregates honest (T3610 §0B.6):
      // drop the card now, refetch the summary (counts/eligibility change).
      collections.removeMember(download.id);
      collections.fetchSummary();
    }
  };

  const handleDownload = (e, download) => {
    e.stopPropagation();
    console.log('[DownloadsPanel] handleDownload:', { id: download.id, project_name: download.project_name });
    // Filename is controlled by backend's Content-Disposition header (single source of truth)
    downloadFile(download.id);
  };

  const handlePlay = (e, download) => {
    e.stopPropagation();
    setWarmupPriority(WARMUP_PRIORITY.FOREGROUND_DIRECT);
    // Single reel = a one-reel story, played through the SAME player as collections.
    // Watched-marking happens via the player's onReelChange (handleReelWatched),
    // the single source for both the single-reel and collection paths (T3900).
    watchedThisSessionRef.current.clear();
    setStoryPlayer({
      reels: [toPlayerReel(download)],
      title: download.project_name,
      downloadId: download.id,
    });
    // Do NOT close the panel here: the player renders above it (z-[70] vs the
    // panel's z-50), and collection playback (onPlayCollection) already leaves
    // My Reels open. Closing only on single-reel play made the panel vanish
    // "sometimes" — exiting the player dropped the user back to the app instead
    // of My Reels. Only the X button closes the panel now.
    // T540: Record achievements for viewing gallery video
    useQuestStore.getState().recordAchievement('viewed_gallery_video');
    // Custom project video gets a separate achievement for Quest 3
    if (download.source_type === SourceType.CUSTOM_PROJECT) {
      useQuestStore.getState().recordAchievement('viewed_custom_project_video');
    }
    // T780: Record "watched 1s" achievement after 1 second of playback (autoPlay = true)
    clearTimeout(watchTimerRef.current);
    watchTimerRef.current = setTimeout(() => {
      useQuestStore.getState().recordAchievement('watched_gallery_video_1s');
    }, 1000);
  };

  // Card folder button -> same shared restore-then-navigate path as the players (T3940).
  const handleOpenProject = (e, download) => {
    e.stopPropagation();
    if (onOpenProject) openReelAsProject(download);
  };

  // Check if folder button should be shown for a download
  const canOpenSource = (download) => {
    if (download.project_id && download.project_id !== 0 && onOpenProject) {
      return true;
    }
    return false;
  };

  const handleBeforeAfter = async (e, download) => {
    e.stopPropagation();
    setExportingBeforeAfter(download.id);

    try {
      // First check if before/after is available
      const statusRes = await apiFetch(`${API_BASE}/api/export/before-after/${download.id}/status`);
      const status = await statusRes.json();

      if (!status.available) {
        alert(status.error || 'Before/After comparison not available for this video');
        return;
      }

      // Generate separate before/after videos (no text overlays) as a zip
      const response = await apiFetch(`${API_BASE}/api/export/before-after/${download.id}?output=separate&overlays=false`, {
        method: 'POST'
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to generate comparison video');
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `before_after_${download.project_name || download.id}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

    } catch (error) {
      console.error('[DownloadsPanel] Before/After export error:', error);
      alert(`Failed to generate comparison: ${error.message}`);
    } finally {
      setExportingBeforeAfter(null);
    }
  };

  // Find the latest unwatched download ID (first unwatched in created_at DESC order)
  const latestUnwatchedId = downloads.find(d => !d.watched_at)?.id ?? null;

  const getUnwatchedStyle = (downloadId) => {
    if (downloadId === latestUnwatchedId) {
      return { border: 'border-cyan-400', dot: 'unwatched-dot unwatched-dot-cyan' };
    }
    return { border: 'border-blue-500', dot: 'bg-blue-500' };
  };

  // Share via the native sheet (mobile). Falls back to the ShareModal on failure.
  const webShareReel = async (e, download) => {
    e.stopPropagation();
    try {
      const filename = `${download.project_name || 'highlight'}-highlight.mp4`;
      const method = await webShare({
        downloadId: download.id,
        title: download.project_name || 'Highlight Reel',
        text: `Check out ${download.project_name || 'this highlight reel'}!`,
        filename,
      });
      track('share_initiated', { method, source: 'gallery' });
      if (method === 'clipboard') {
        toast.success('Link copied to clipboard', { dedupKey: 'copy-link' });
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
      setSharingDownload(download);
    }
  };

  // Copy a share link (desktop). Falls back to the ShareModal on failure.
  const copyReelLink = async (e, download) => {
    e.stopPropagation();
    try {
      await copyLink({ downloadId: download.id });
      track('share_initiated', { method: 'clipboard', source: 'gallery' });
      toast.success('Link copied to clipboard', { dedupKey: 'copy-link' });
    } catch (err) {
      if (err.name === 'AbortError') return;
      setSharingDownload(download);
    }
  };

  // Rename gesture -> surgical PATCH + keep the cached member list honest.
  const renameReel = (id, name) => {
    renameDownload(id, name);
    collections.patchMember(id, { project_name: name });
  };

  // A compact metadata line for the tile scrim: date · duration · game-time.
  const reelMetaLine = (download) => [
    formatDate(download.created_at),
    formatDurationHuman(download.duration),
    formatGameClock(download.clip_game_start_time),
  ].filter(Boolean).join(' · ');

  // Render one published reel as a poster tile (T5673). Per-tile poster load
  // state lives in ReelTile (a component, not this closure).
  const renderDownloadCard = (download) => (
    <ReelTile
      key={download.id}
      download={download}
      posterUrl={`${API_BASE}/api/downloads/${download.id}/poster.jpg`}
      isUnwatched={!download.watched_at}
      unwatchedStyle={getUnwatchedStyle(download.id)}
      isMobile={isMobile}
      displayName={download.project_name}
      metaLine={reelMetaLine(download)}
      onPlay={handlePlay}
      onWebShare={webShareReel}
      onCopyLink={copyReelLink}
      onDownload={handleDownload}
      downloadingId={downloadingId}
      onBeforeAfter={handleBeforeAfter}
      exportingBeforeAfter={exportingBeforeAfter}
      showBeforeAfter={!import.meta.env.PROD}
      onOpenProject={handleOpenProject}
      canOpenSource={canOpenSource}
      restoringId={restoringId}
      onMove={(d) => setMovingIds([d.id])}
      canMoveProfiles={canMoveProfiles}
      onDelete={handleDelete}
      onRename={renameReel}
    />
  );

  return (
    <>
      {isOpen && <>
      {/* Backdrop — visual only. No click-to-close (misclicks must not dismiss
          My Reels); the X button is the only way to close. */}
      <div className="fixed inset-0 bg-black/50 z-40" />

      {/* Panel */}
      <div className="fixed right-0 top-0 h-full w-full max-w-md bg-gray-800 shadow-xl z-50 flex flex-col border-l border-gray-700 animate-slide-in-right">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <div className="flex items-center gap-3">
            <Image size={20} className={REEL.accent} />
            <h2 className="text-lg font-bold text-white">{SECTION_NAMES.LIBRARY}</h2>
            {unseenReelsCount > 0 && (
              <span className={`px-2 py-0.5 ${REEL.bg} text-white text-xs font-medium rounded-full`}>
                {unseenReelsCount}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              icon={X}
              iconOnly
              onClick={close}
            />
          </div>
        </div>

        {/* Content — single My Reels view (T3610 §0B.1) */}
        <div className="flex-1 overflow-y-auto p-4">
          <ConfidenceBanner
            onRank={() => setShowRankingGame(true)}
            refreshKey={rankRefreshKey}
          />
          <CollectionsTab
            collections={collections}
            renderCard={renderDownloadCard}
            onPlayCollection={onPlayCollection}
            onShareCollection={onShareCollection}
            onCopyCollectionLink={onCopyCollectionLink}
          />
        </div>
      </div>

      {/* Animation styles */}
      <style>{`
        @keyframes slideInRight {
          from {
            transform: translateX(100%);
          }
          to {
            transform: translateX(0);
          }
        }
        .animate-slide-in-right {
          animation: slideInRight 0.2s ease-out forwards;
        }
      `}</style>
      </>}

      {/* Share Modal */}
      {sharingDownload && (
        <ShareModal
          videoId={sharingDownload.id}
          videoName={sharingDownload.project_name}
          onClose={() => setSharingDownload(null)}
        />
      )}

      {/* Collection Share Modal (T3620) */}
      {sharingCollection && (
        <CollectionShareModal
          definition={sharingCollection.definition}
          title={sharingCollection.title}
          onClose={() => setSharingCollection(null)}
        />
      )}

      {/* Move-to-profile picker (T4850) */}
      {movingIds && (
        <MoveToProfileModal
          videoIds={movingIds}
          otherProfiles={otherProfiles}
          moving={moving}
          onMove={(targetProfileId) => moveReels(movingIds, targetProfileId)}
          onClose={() => { if (!moving) setMovingIds(null); }}
        />
      )}

      {/* Ranking game (T3630) — full-screen, opened from the ConfidenceBanner. */}
      {showRankingGame && (
        <RankingGame
          onClose={closeRankingGame}
          onReEdit={onOpenProject ? openReelAsProject : undefined}
        />
      )}

      {/* Shared story player — single reels AND collections play here, at the
          panel top level so it fills the viewport (T3610). */}
      {storyPlayer && (
        <CollectionPlayer
          reels={storyPlayer.reels}
          title={storyPlayer.title}
          onReelChange={handleReelWatched}
          onClose={closeStoryPlayer}
          onDownload={storyPlayer.downloadId ? () => downloadFile(storyPlayer.downloadId) : undefined}
          downloadLoading={storyPlayer.downloadId ? downloadingId === storyPlayer.downloadId : false}
          onReEdit={onOpenProject ? openReelAsProject : undefined}
          reEditLoadingId={restoringId}
          onReRank={handleReRank}
          reRankLoadingId={reRankingId}
        />
      )}
    </>
  );
}

export default DownloadsPanel;
