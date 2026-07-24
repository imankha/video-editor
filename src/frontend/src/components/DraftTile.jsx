import React, { useState, useRef } from 'react';
import { Star, Pencil, CheckCircle, Tag, Loader2, Image, Trash2, Play, Crop, Layers, EyeOff, X, Film } from 'lucide-react';
import { Button } from './shared/Button';
import { MediaPlayer } from './MediaPlayer';
import { SegmentedProgressStrip } from './shared/SegmentedProgressStrip';
import { useProjectsStore } from '../stores/projectsStore';
import { useSyncStore } from '../stores/syncStore';
import { useExportStore } from '../stores/exportStore';
import { useGalleryStore } from '../stores/galleryStore';
import { useQuestStore } from '../stores/questStore';
import { useIsMobile } from '../hooks/useIsMobile';
import apiFetch from '../utils/apiFetch';
import { API_BASE } from '../config';
import { getProjectDisplayName } from '../utils/clipDisplayName';
import { formatGameClock } from '../utils/timeFormat';
import { SECTION_NAMES } from '../config/displayNames';
import { REEL } from '../config/themeColors';

/**
 * DraftTile - a reel draft as a portrait 9:16 poster tile (T5672).
 *
 * Presentational shell over the SAME handlers the old list card used (open, publish,
 * rename, delete, preview) — this restyle is view-only, no persistence change.
 *
 * Click behavior:
 * - Primary tap on the tile: open with smart mode (auto-detect next action)
 * - Click a progress-strip segment: open in framing (that clip) / overlay
 * - Ready-to-publish corner badge: Move to My Reels (also in the hover/long-press actions)
 */
export function DraftTile({ project, onSelect, onSelectWithMode, onDelete, exportingProject = null, pendingGameIds = new Set() }) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  // T4050: when a durable publish fails to reach R2 (503 sync_failed), the card
  // stays put and we stash the gesture args so the user can Retry the exact same
  // "Move to My Reels" with one click (no refetch, no optimistic removal).
  const [publishRetry, setPublishRetry] = useState(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [actionsRevealed, setActionsRevealed] = useState(false);
  // Poster load lifecycle (T5672): 'loading' -> skeleton shimmer; 'loaded' -> poster;
  // 'error' -> branded fallback (the T5671 endpoint 404s when no poster exists).
  const [posterState, setPosterState] = useState('loading');
  const longPressTimer = useRef(null);
  const touchMoved = useRef(false);
  const longPressFired = useRef(false);
  const isMobile = useIsMobile();
  const isOffline = useSyncStore((state) => state.isOffline);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef(null);
  const renameProject = useProjectsStore(state => state.renameProject);
  const fetchProjects = useProjectsStore(state => state.fetchProjects);

  const publishProject = async ({ openGallery }) => {
    setIsPublishing(true);
    // T4050 publish tracing: card removal is driven by fetchProjects re-reading
    // backend state below (NOT an optimistic local removal). These [Publish] logs
    // let a real "Move to My Reels" attempt be traced end-to-end (click -> POST ->
    // 200 -> refetch) and correlated with the backend [Publish]/[SYNC] log lines.
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
          setPublishRetry({ openGallery });
          return;
        }
      }
      if (!response.ok) {
        const error = await response.json();
        // Card is NOT removed on failure: we throw before fetchProjects, the catch
        // alerts, and the draft stays put.
        console.warn(`[Publish] project=${project.id} FAILED status=${response.status} - card kept in Drafts`);
        throw new Error(error.detail || 'Failed to publish');
      }
      const result = await response.json();
      setPublishRetry(null);
      console.log(`[Publish] project=${project.id} 200 ok archived=${result.archived} final_video_id=${result.final_video_id}`);
      if (!result.archived) {
        console.warn(`[ProjectCard] Project ${project.id} published but archive failed - card stays in Drafts.`);
      }
      // Model changed (a reel was published) -> update count badge + dispatch the
      // collections-changed event so the My Reels list refreshes itself.
      useGalleryStore.getState().fetchCount({ force: true });
      useGalleryStore.getState().notifyCollectionsChanged();
      console.log(`[Publish] project=${project.id} refetching projects (card removal reflects backend state)`);
      fetchProjects({ force: true });
      // quest_4 "Move to My Reels" step — the publish gesture completes it.
      useQuestStore.getState().recordAchievement('moved_to_my_reels');
      if (openGallery) {
        useGalleryStore.getState().open();
      }
    } catch (error) {
      console.error('[Publish] error:', error);
      alert(`Failed to move to ${SECTION_NAMES.LIBRARY}: ${error.message}`);
    } finally {
      setIsPublishing(false);
    }
  };

  const handlePublishToMyReels = (e) => {
    e.stopPropagation();
    publishProject({ openGallery: true });
  };

  const handleHideFromDrafts = (e) => {
    e.stopPropagation();
    publishProject({ openGallery: false });
  };

  const handleStartRename = (e) => {
    e.stopPropagation();
    setRenameValue(project.name || '');
    setIsRenaming(true);
    setTimeout(() => renameInputRef.current?.select(), 0);
  };

  const handleSaveRename = async () => {
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === project.name) {
      setIsRenaming(false);
      return;
    }
    try {
      await renameProject(project.id, trimmed);
    } catch {
      // Revert on failure — store didn't update
    }
    setIsRenaming(false);
  };

  const handleRenameKeyDown = (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      handleSaveRename();
    } else if (e.key === 'Escape') {
      setIsRenaming(false);
    }
  };

  // Check export store for active exports (survives refresh)
  const activeExports = useExportStore((state) => state.activeExports);
  const storeExport = Object.values(activeExports).find(
    (exp) => exp.projectId === project.id && (exp.status === 'pending' || exp.status === 'processing')
  );

  // Determine if this project is currently exporting
  // Check both context (current session) and store (recovered from server)
  const isExporting = exportingProject?.projectId === project.id
    ? exportingProject.stage
    : storeExport?.type || null;

  // Check for failed exports (only when not actively exporting)
  const failedExport = !isExporting
    ? Object.values(activeExports).find(
        (exp) => exp.projectId === project.id && exp.status === 'error'
      ) || null
    : null;
  const failedExportType = failedExport?.type || null;

  const isWaitingForUpload = project.game_ids?.some(id => pendingGameIds.has(id));
  const canOpen = !isWaitingForUpload;

  const handleDelete = (e) => {
    e.stopPropagation();
    if (showDeleteConfirm) {
      onDelete();
    } else {
      setShowDeleteConfirm(true);
      // Auto-hide after 3 seconds
      setTimeout(() => setShowDeleteConfirm(false), 3000);
    }
  };

  const handleClipClick = (clipIndex) => {
    if (!canOpen) return; // Block if no clips extracted
    if (onSelectWithMode) {
      onSelectWithMode({ mode: 'framing', clipIndex });
    }
  };

  const handleOverlayClick = () => {
    if (!canOpen) return; // Block if no clips extracted
    if (onSelectWithMode) {
      onSelectWithMode({ mode: 'overlay' });
    }
  };

  const handleCardClick = () => {
    if (isRenaming) return;
    if (isMobile && actionsRevealed) {
      setActionsRevealed(false);
      return;
    }
    if (!canOpen) return;
    const needsOverlay = project.has_working_video && (
      !project.has_final_video ||
      (project.working_video_created_at && project.final_video_created_at &&
       project.working_video_created_at > project.final_video_created_at)
    );
    if (needsOverlay) {
      onSelectWithMode({ mode: 'overlay' });
    } else {
      onSelect();
    }
  };

  const handleTouchStart = () => {
    touchMoved.current = false;
    longPressFired.current = false;
    longPressTimer.current = setTimeout(() => {
      longPressTimer.current = null;
      longPressFired.current = true;
      setActionsRevealed(true);
    }, 500);
  };

  const handleTouchMove = () => {
    touchMoved.current = true;
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const handleTouchEnd = (e) => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    if (longPressFired.current) {
      e.preventDefault();
    }
  };

  const isComplete = project.has_final_video;
  const isReadyToPublish = isComplete && !project.is_published;

  const posterUrl = `${API_BASE}/api/projects/${project.id}/poster.jpg`;
  const gameClock = formatGameClock(project.clip_game_start_time);
  // Q4: one tag chip, only on wider (>=sm) tiles — dropped on narrow mobile tiles.
  const firstTag = project.is_auto_created ? project.clips?.[0]?.tags?.[0] : null;

  // Short status label + tint for the corner chip (Q7: kept alongside the slim
  // progress strip). Mirrors the old metadata-row status logic, condensed to one word.
  let statusLabel = 'Not started';
  let statusTint = 'text-gray-200';
  if (isComplete) { statusLabel = 'Done'; statusTint = 'text-green-300'; }
  else if (isWaitingForUpload) { statusLabel = 'Uploading'; statusTint = 'text-amber-300'; }
  else if (isExporting && isOffline) { statusLabel = 'Offline'; statusTint = 'text-gray-300'; }
  else if (isExporting) { statusLabel = 'Exporting'; statusTint = 'text-amber-300'; }
  else if (failedExportType) { statusLabel = 'Failed'; statusTint = 'text-orange-300'; }
  else if (project.has_working_video) { statusLabel = 'In Overlay'; statusTint = 'text-blue-300'; }
  else if (project.clips_in_progress > 0) { statusLabel = 'Framing'; statusTint = 'text-blue-300'; }
  else if (project.clips_exported > 0) { statusLabel = 'Exported'; statusTint = 'text-gray-200'; }

  // Desktop reveals actions on hover; mobile reveals them on long-press (actionsRevealed).
  const actionsVisibility = isMobile
    ? (actionsRevealed ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none')
    : 'opacity-0 pointer-events-none group-hover/tile:opacity-100 group-hover/tile:pointer-events-auto';
  const actionBtnClass = 'coarse-pointer:min-h-[44px] coarse-pointer:min-w-[44px]';

  return (
    <div
      data-testid="project-card"
      onClick={isReadyToPublish ? undefined : handleCardClick}
      onTouchStart={isMobile ? handleTouchStart : undefined}
      onTouchMove={isMobile ? handleTouchMove : undefined}
      onTouchEnd={isMobile ? handleTouchEnd : undefined}
      className={`group/tile relative shrink-0 snap-start w-[40vw] max-w-[200px] sm:w-[168px] aspect-[9/16] rounded-lg overflow-hidden bg-gray-800 border transition-colors ${
        canOpen ? `cursor-pointer border-gray-700 ${REEL.borderHover}` : 'cursor-not-allowed border-gray-700 opacity-75'
      }`}
    >
      {/* Poster image (lazy — 13+ tiles must not fire eager requests) */}
      {posterState !== 'error' && (
        <img
          src={posterUrl}
          alt=""
          loading="lazy"
          onLoad={() => setPosterState('loaded')}
          onError={() => setPosterState('error')}
          className="absolute inset-0 w-full h-full object-cover"
        />
      )}
      {/* Skeleton shimmer while the poster loads */}
      {posterState === 'loading' && (
        <div className="absolute inset-0 bg-gray-700 animate-pulse" />
      )}
      {/* Branded fallback on 404 / decode error (no broken image) */}
      {posterState === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-2 bg-gradient-to-br from-cyan-900 via-gray-800 to-gray-900">
          <Film size={26} className="text-cyan-300/80" />
          <span className="text-[11px] text-gray-200 text-center line-clamp-3 px-1">{getProjectDisplayName(project)}</span>
        </div>
      )}

      {/* Auto-created marker — labeled chip instead of bare icon */}
      {project.is_auto_created && (
        <span
          className="absolute top-1.5 left-1.5 z-20 inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-semibold bg-amber-500/90 text-white shadow hover:bg-amber-400 transition-colors"
          title="Created automatically by the system"
          aria-label="Auto-created reel"
        >
          <Star size={12} fill="currentColor" />
          Auto
        </span>
      )}

      {/* Ready-to-publish badge (Q3) — persistent affordance; tap publishes (also on mobile) */}
      {isReadyToPublish && (
        <button
          type="button"
          onClick={handlePublishToMyReels}
          disabled={isPublishing}
          aria-label={`Move to ${SECTION_NAMES.LIBRARY}`}
          title={`Move to ${SECTION_NAMES.LIBRARY}`}
          className="absolute top-1.5 left-1.5 z-30 inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-semibold bg-cyan-500/90 text-white shadow hover:bg-cyan-400 disabled:opacity-60 coarse-pointer:min-h-[44px] coarse-pointer:px-3"
        >
          {isPublishing ? <Loader2 size={12} className="animate-spin" /> : <Image size={12} />}
          Ready
        </button>
      )}

      {/* Status chip (Q7) */}
      <span className={`absolute top-1.5 right-1.5 z-20 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-black/60 backdrop-blur-sm ${statusTint}`}>
        {statusLabel}
      </span>

      {/* In-My-Reels marker for published-complete reels */}
      {isComplete && project.is_published && (
        <span className="absolute top-9 right-1.5 z-20 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] bg-black/60 backdrop-blur-sm text-cyan-300" title={`In ${SECTION_NAMES.LIBRARY}`}>
          <CheckCircle size={11} />
        </span>
      )}

      {/* Bottom scrim: name, game-time, one tag (>=sm) */}
      <div className="absolute inset-x-0 bottom-0 z-10 px-2 pt-8 pb-3 bg-gradient-to-t from-black/85 via-black/45 to-transparent">
        {isRenaming ? (
          <input
            ref={renameInputRef}
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={handleRenameKeyDown}
            onBlur={handleSaveRename}
            onClick={(e) => e.stopPropagation()}
            className={`w-full text-white text-xs font-medium bg-black/40 border-b ${REEL.border} outline-none`}
            autoFocus
          />
        ) : (
          <h3 className="text-white text-xs font-medium leading-tight line-clamp-2 drop-shadow">
            {getProjectDisplayName(project)}
          </h3>
        )}
        <div className="mt-0.5 flex items-center gap-1.5 flex-nowrap overflow-hidden">
          {gameClock && (
            <span className="shrink-0 text-[11px] text-gray-300" title="Game time">{gameClock}</span>
          )}
          {firstTag && (
            <span className="hidden sm:inline-flex shrink-0 items-center gap-0.5 px-1 py-0.5 text-[10px] rounded bg-black/50 text-cyan-200">
              <Tag size={9} />
              <span className="truncate max-w-[80px]">{firstTag}</span>
            </span>
          )}
        </div>
      </div>

      {/* Slim progress strip pinned to the base (Q7 deep-link stays clickable) */}
      <div className="absolute inset-x-0 bottom-0 z-20 px-0.5 pb-0.5">
        <SegmentedProgressStrip
          project={project}
          onClipClick={handleClipClick}
          onOverlayClick={handleOverlayClick}
          isExporting={isExporting}
          isOffline={isOffline}
          failedExportType={failedExportType}
          variant="slim"
        />
      </div>

      {/* Actions — desktop hover / mobile long-press sheet. Every old card action reachable. */}
      <div className={`absolute top-9 right-1.5 z-30 flex flex-col items-end gap-1 transition-opacity ${actionsVisibility}`}>
        {isComplete && project.final_video_id && (
          <Button variant="secondary" size="sm" icon={Play} iconOnly onClick={(e) => { e.stopPropagation(); setIsPreviewing(true); }} title="Preview video" className={actionBtnClass} />
        )}
        <Button variant="secondary" size="sm" icon={Pencil} iconOnly onClick={handleStartRename} title="Rename reel" className={actionBtnClass} />
        {isComplete && (
          <Button variant="secondary" size="sm" icon={Crop} iconOnly onClick={(e) => { e.stopPropagation(); handleClipClick(0); }} title="Open in Framing" className={actionBtnClass} />
        )}
        {isComplete && (
          <Button variant="secondary" size="sm" icon={Layers} iconOnly onClick={(e) => { e.stopPropagation(); handleOverlayClick(); }} title="Open in Overlay" className={actionBtnClass} />
        )}
        {isComplete && !isReadyToPublish && (
          <Button variant="secondary" size="sm" icon={EyeOff} iconOnly loading={isPublishing} onClick={handleHideFromDrafts} title={`Hide from Drafts (stays in ${SECTION_NAMES.LIBRARY})`} className={actionBtnClass} />
        )}
        <Button variant={showDeleteConfirm ? 'danger' : 'secondary'} size="sm" icon={Trash2} iconOnly onClick={handleDelete} title={showDeleteConfirm ? 'Click again to confirm' : 'Delete reel'} className={actionBtnClass} />
      </div>

      {/* Durable publish failure — keep the tile and let the user retry (T4050) */}
      {publishRetry && (
        <div className="absolute inset-x-1 bottom-8 z-40 flex flex-col items-center gap-1 rounded-md bg-black/85 p-2 text-center" role="alert">
          <span className="text-[10px] text-amber-300">Couldn&apos;t save to the cloud.</span>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); publishProject(publishRetry); }}
            disabled={isPublishing}
            className="px-3 py-1 rounded-md text-[11px] font-medium border border-amber-500 text-amber-300 hover:bg-amber-900/30 disabled:opacity-50"
          >
            Retry
          </button>
        </div>
      )}

      {/* Video preview modal */}
      {isPreviewing && project.final_video_id && (
        <>
          <div
            className="fixed inset-0 bg-black/80 z-[60]"
            onClick={(e) => { e.stopPropagation(); setIsPreviewing(false); }}
          />
          <div className="fixed inset-4 md:inset-12 lg:inset-20 z-[70] flex flex-col bg-gray-900 rounded-xl overflow-hidden shadow-2xl">
            <div className="flex items-center justify-between p-4 border-b border-gray-700 bg-gray-800">
              <div className="flex items-center gap-3">
                <Film size={20} className={REEL.accent} />
                <h3 className="text-white font-medium">{getProjectDisplayName(project)}</h3>
              </div>
              <Button
                variant="ghost"
                size="sm"
                icon={X}
                iconOnly
                onClick={(e) => { e.stopPropagation(); setIsPreviewing(false); }}
              />
            </div>
            <div className="flex-1 min-h-0">
              <MediaPlayer
                src={`${API_BASE}/api/downloads/${project.final_video_id}/stream`}
                autoPlay
                onClose={() => setIsPreviewing(false)}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default DraftTile;
