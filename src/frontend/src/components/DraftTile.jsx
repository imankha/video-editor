import React, { useState, useRef } from 'react';
import { Star, Pencil, CheckCircle, Tag, Upload, Loader2, Image, Trash2, Play, Crop, Layers, EyeOff, X, Film } from 'lucide-react';
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
 * ProjectCard - Individual project in the list
 *
 * Click behavior:
 * - Click on project name/info area: Open with smart mode (auto-detect next action)
 * - Click on a clip segment: Open in framing mode with that clip selected
 * - Click on overlay segment: Open in overlay mode
 */
export function ProjectCard({ project, onSelect, onSelectWithMode, onDelete, exportingProject = null, pendingGameIds = new Set() }) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  // T4050: when a durable publish fails to reach R2 (503 sync_failed), the card
  // stays put and we stash the gesture args so the user can Retry the exact same
  // "Move to My Reels" with one click (no refetch, no optimistic removal).
  const [publishRetry, setPublishRetry] = useState(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [actionsRevealed, setActionsRevealed] = useState(false);
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

  return (
    <div
      data-testid="project-card"
      onClick={isReadyToPublish ? undefined : handleCardClick}
      onTouchStart={isMobile ? handleTouchStart : undefined}
      onTouchMove={isMobile ? handleTouchMove : undefined}
      onTouchEnd={isMobile ? handleTouchEnd : undefined}
      className={`group relative p-3 sm:p-4 bg-gray-800 rounded-lg border transition-all ${
        isReadyToPublish
          ? 'border-gray-700'
          : canOpen
            ? `hover:bg-gray-750 cursor-pointer border-gray-700 ${REEL.borderHover}`
            : 'cursor-not-allowed border-gray-700 opacity-75'
      }`}
      title={undefined}
    >
      <div className="flex items-center justify-between">
        <div className="flex-1 min-w-0">
          {/* Name row */}
          <div className="flex items-center gap-2">
            {project.is_auto_created && (
              <Star size={14} className="text-yellow-400 flex-shrink-0" fill="currentColor" title="Auto-created reel" />
            )}
            {isRenaming ? (
              <input
                ref={renameInputRef}
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={handleRenameKeyDown}
                onBlur={handleSaveRename}
                onClick={(e) => e.stopPropagation()}
                className={`text-white font-medium bg-transparent border-b ${REEL.border} outline-none w-full`}
                autoFocus
              />
            ) : (
              <>
                <h3 className="text-white font-medium truncate">
                  {getProjectDisplayName(project)}
                </h3>
                <button
                  onClick={handleStartRename}
                  className={`${isMobile ? (actionsRevealed ? 'opacity-60' : 'opacity-0 pointer-events-none') : 'opacity-0 group-hover:opacity-60 hover:!opacity-100'} text-gray-400 transition-opacity flex-shrink-0`}
                  title="Rename reel"
                >
                  <Pencil size={14} />
                </button>
              </>
            )}
            {isComplete && project.is_published && (
              <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs ${REEL.bgMuted} ${REEL.accent} flex-shrink-0`}>
                <CheckCircle size={12} />
                In {SECTION_NAMES.LIBRARY}
              </span>
            )}
            {/* T3920: clip's game time (single-clip drafts only) */}
            {formatGameClock(project.clip_game_start_time) && (
              <span className="shrink-0 text-sm text-gray-400" title="Game time">
                {formatGameClock(project.clip_game_start_time)}
              </span>
            )}
          </div>

          {/* Tags row */}
          {project.is_auto_created && project.clips?.[0]?.tags?.length > 0 && (
            <div className="flex items-center gap-1 mt-1 flex-wrap">
              {project.clips[0].tags.map((tag, idx) => (
                <span
                  key={idx}
                  className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 text-xs ${REEL.bgMuted} ${REEL.accentMuted} rounded`}
                >
                  <Tag size={10} />
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* Metadata row */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1 text-sm text-gray-400">
            <span>{project.aspect_ratio}</span>
            <span>•</span>
            <span>{project.clip_count} clip{project.clip_count !== 1 ? 's' : ''}</span>
            {isComplete && (
              <>
                <span>•</span>
                <span className="inline-flex items-center gap-1 text-green-400">
                  <CheckCircle size={12} />
                  Done
                </span>
              </>
            )}
            {!project.has_final_video && (
              <>
                <span>•</span>
                <span>
                  {isWaitingForUpload ? (
                    <span className="text-amber-400 inline-flex items-center gap-1">
                      <Upload size={12} />
                      Waiting for upload
                    </span>
                  ) :
                  isExporting && isOffline ? (
                    <span className="text-gray-400">Disconnected</span>
                  ) :
                  isExporting === 'overlay' ? (
                    <span className="text-amber-400">Exporting...</span>
                  ) :
                  isExporting === 'framing' ? (
                    <span className="text-amber-400">Exporting...</span>
                  ) :
                  failedExportType ? (
                    <span className="text-orange-400">Export Failed</span>
                  ) :
                  project.has_working_video ? 'In Overlay' :
                  project.clips_in_progress > 0 ? (
                    <span className="text-blue-400">Framing started</span>
                  ) :
                  project.clips_exported > 0 ? 'Exported' : 'Not Started'}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Top-right: Move CTA for ready-to-publish, delete icon for other states */}
        {isReadyToPublish ? (
          <button
            onClick={handlePublishToMyReels}
            disabled={isPublishing}
            className={`flex-shrink-0 flex items-center justify-center gap-2 px-6 py-3 rounded-lg text-base font-medium bg-transparent ${REEL.accent} border-2 ${REEL.borderSubtle} hover:bg-cyan-900/30 hover:text-cyan-300 hover:border-cyan-500 transition-all disabled:opacity-50`}
          >
            {isPublishing ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <Image size={18} />
            )}
            Move to {SECTION_NAMES.LIBRARY}
          </button>
        ) : (
          <Button
            variant={showDeleteConfirm ? 'danger' : 'ghost'}
            size="sm"
            icon={Trash2}
            iconOnly
            onClick={handleDelete}
            className={isMobile
              ? (!showDeleteConfirm && !actionsRevealed ? 'opacity-0 pointer-events-none' : '')
              : (!showDeleteConfirm ? 'opacity-0 group-hover:opacity-100' : '')}
            title={showDeleteConfirm ? 'Click again to confirm' : 'Delete reel'}
          />
        )}
      </div>

      {publishRetry && (
        /* T4050: durable publish couldn't reach the cloud — keep the card and let
           the user retry the same gesture instead of silently reverting later. */
        <div className="mt-2 flex items-center justify-center gap-2 text-sm" role="alert">
          <span className="text-amber-400">Couldn&apos;t save to the cloud.</span>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); publishProject(publishRetry); }}
            disabled={isPublishing}
            className="px-3 py-1 rounded-md font-medium border border-amber-500 text-amber-300 hover:bg-amber-900/30 disabled:opacity-50"
          >
            Retry
          </button>
        </div>
      )}

      {isComplete ? (
        /* Secondary actions row — shown for all Done reels, published or not */
        <div className="mt-2 flex items-center justify-center gap-2">
          {project.final_video_id && (
            <Button
              variant="ghost"
              size="sm"
              icon={Play}
              iconOnly
              onClick={(e) => { e.stopPropagation(); setIsPreviewing(true); }}
              title="Preview video"
            />
          )}
          <Button
            variant="ghost"
            size="sm"
            icon={Crop}
            iconOnly
            onClick={(e) => { e.stopPropagation(); handleClipClick(0); }}
            title="Open in Framing"
          />
          <Button
            variant="ghost"
            size="sm"
            icon={Layers}
            iconOnly
            onClick={(e) => { e.stopPropagation(); handleOverlayClick(); }}
            title="Open in Overlay"
          />
          {isReadyToPublish ? (
            <Button
              variant={showDeleteConfirm ? 'danger' : 'ghost'}
              size="sm"
              icon={Trash2}
              iconOnly
              onClick={handleDelete}
              title={showDeleteConfirm ? 'Click again to confirm' : 'Delete reel'}
            />
          ) : (
            <Button
              variant="ghost"
              size="sm"
              icon={EyeOff}
              iconOnly
              loading={isPublishing}
              onClick={handleHideFromDrafts}
              title={`Hide from Drafts (stays in ${SECTION_NAMES.LIBRARY})`}
            />
          )}
        </div>
      ) : (
        /* Segmented progress strip - clickable segments for direct navigation */
        <SegmentedProgressStrip
          project={project}
          onClipClick={handleClipClick}
          onOverlayClick={handleOverlayClick}
          isExporting={isExporting}
          isOffline={isOffline}
          failedExportType={failedExportType}
        />
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

export default ProjectCard;
