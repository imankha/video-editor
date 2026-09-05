import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Z } from '../constants/zLayers';
import { Pencil, CheckCircle, Tag, Loader2, FolderInput, MoreVertical, Trash2, Play, Crop, Layers, EyeOff, Film, AlertTriangle, Clock } from 'lucide-react';
import { Button } from './shared/Button';
import { SegmentedProgressStrip } from './shared/SegmentedProgressStrip';
import { TilePreviewVideo } from './collections/TilePreviewVideo';
import { useTilePreview } from '../hooks/useTilePreview';
import { useProjectsStore } from '../stores/projectsStore';
import { useCurrentProfile } from '../stores/profileStore';
import { useSyncStore } from '../stores/syncStore';
import { useExportStore } from '../stores/exportStore';
import { useReelPreviewStore } from '../stores/reelPreviewStore';
import { usePublishProject } from '../hooks/usePublishProject';
import { useIsCoarsePointer } from '../hooks/useIsMobile';
import { openFinishedReel } from '../utils/finishedReelNav';
import { API_BASE } from '../config';
import { getProjectDisplayName } from '../utils/clipDisplayName';
import { formatGameClock } from '../utils/timeFormat';
import { SECTION_NAMES } from '../config/displayNames';
import { REEL } from '../config/themeColors';
import { RATIO } from '../constants/aspectRatios';
import { rendersSourceAspect } from '../utils/draftStage';
import { staleClipCount } from '../utils/reelStaleness';

/**
 * DraftTile - a draft (single-clip or multi-clip) as a poster tile (T5672). Shell aspect follows the
 * draft's target ratio (portrait 9:16 or landscape 16:9, T5673) except for
 * drafts not yet framed, which render landscape at SOURCE aspect: Not-Started
 * (T6800) and In-Framing-but-uncropped (T6900) drafts alike.
 *
 * Presentational shell over the SAME handlers the old list card used (open, publish,
 * rename, delete, preview) — this restyle is view-only, no persistence change.
 *
 * Click behavior:
 * - Primary tap on the tile: open with smart mode (auto-detect next action)
 * - Click a progress-strip segment: open in framing (that clip) / overlay
 * - Ready-to-publish tile (T6180): the body tap PREVIEWS (was inert before). The
 *   publish gesture is a dedicated primary "Move to My Reels" button in the
 *   persistent bottom action bar; "Ready" is a non-interactive status badge; the
 *   remaining actions (Rename/Framing/Overlay/Hide/Delete) live in a kebab menu.
 *   The progress strip and the "Done" status chip are suppressed in this one state.
 */
export function DraftTile({ project, onSelect, onSelectWithMode, onDelete, exportingProject = null, pendingGameIds = new Set(), sourceExpiry = null }) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  // T8530: publish is the shared usePublishProject gesture (extracted from this
  // component so DraftTile + the draft preview player run ONE publish path,
  // carrying the T4050 durable-sync contract verbatim). `publishRetry` still
  // drives the in-card Retry surface below on a 503 sync_failed.
  const { publish: publishProject, isPublishing, publishRetry } = usePublishProject(project);
  // T8535: the draft preview is the consolidated DraftReelPreview surface
  // (openFinishedReel) — this tile no longer mounts its own player. Tracking
  // whether THIS project's preview is the one currently open lets the tile
  // release its own inline hover-preview stream while the full player is up
  // (T5900: "full player opening RELEASES it").
  const previewOpenForThisProject = useReelPreviewStore((s) => s.payload?.projectId === project.id);
  const [actionsRevealed, setActionsRevealed] = useState(false);
  // T6180 kebab (ready state only): the five secondary actions collapse behind a
  // menu. Mirrors ReelTile's pattern — a portaled, button-anchored popover on fine
  // pointers, a bottom action sheet on coarse pointers, both closed on outside tap.
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState(null); // {top, left} for the portaled popover
  const menuRef = useRef(null);
  const kebabBtnRef = useRef(null);
  // Poster load lifecycle (T5672): 'loading' -> skeleton shimmer; 'loaded' -> poster;
  // 'error' -> branded fallback (the T5671 endpoint 404s when no poster exists).
  const [posterState, setPosterState] = useState('loading');
  const longPressTimer = useRef(null);
  const touchMoved = useRef(false);
  const longPressFired = useRef(false);
  // T5910: the reveal MECHANISM is gated on pointer capability, not viewport
  // width. useIsMobile is width-OR-touch, so a narrow *desktop* window took the
  // touch-only long-press branch and a mouse user could never reveal the actions.
  // useIsCoarsePointer is true only for touch/pen primary pointers: fine pointer
  // (mouse) at ANY width -> hover reveal; coarse pointer -> long-press, unchanged.
  const isCoarsePointer = useIsCoarsePointer();
  const isOffline = useSyncStore((state) => state.isOffline);
  const currentProfile = useCurrentProfile();
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef(null);
  const renameProject = useProjectsStore(state => state.renameProject);
  // Q3 (item 3): the draft whose project is currently loaded in the editor gets a
  // persistent accent ring so the user can spot "the one I'm working on" in the row.
  const selectedProjectId = useProjectsStore(state => state.selectedProjectId);
  const isCurrentProject = selectedProjectId != null && selectedProjectId === project.id;

  // Position the kebab popover against the button rect and close it on outside tap
  // (fine-pointer popover only; the coarse-pointer sheet is a full-screen overlay
  // that closes on its own backdrop). Flips upward when it would overflow the
  // viewport bottom. Same mechanism as ReelTile.jsx.
  useEffect(() => {
    if (!menuOpen || !kebabBtnRef.current) {
      setMenuPos(null);
      return;
    }
    const updatePosition = () => {
      const rect = kebabBtnRef.current.getBoundingClientRect();
      const menuHeight = 260; // approximate; enough to decide the flip
      const flipped = rect.bottom + menuHeight > window.innerHeight;
      setMenuPos({
        top: flipped ? rect.top - menuHeight : rect.bottom + 4,
        left: rect.right - 192, // w-48 = 192px, right-aligned to the button
      });
    };
    updatePosition();
    const onResize = () => updatePosition();
    window.addEventListener('resize', onResize);
    const onOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target) && !kebabBtnRef.current.contains(e.target)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onOutside);
    document.addEventListener('touchstart', onOutside);
    return () => {
      window.removeEventListener('resize', onResize);
      document.removeEventListener('mousedown', onOutside);
      document.removeEventListener('touchstart', onOutside);
    };
  }, [menuOpen]);

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
    // T6180 — a ready tile's body PREVIEWS (it used to be inert, which is exactly
    // why the user could not act on a finished reel). Publishing has its own primary
    // button; the low-risk body gesture is Preview. Guard on final_video_id: a ready
    // tile without a playable video simply does nothing on body tap.
    if (isReadyToPublish) {
      if (project.final_video_id) openFinishedReel(project);
      return;
    }
    if (isCoarsePointer && actionsRevealed) {
      setActionsRevealed(false);
      return;
    }
    if (!canOpen) return;
    // Item 6 — open the FURTHEST stage the draft has reached:
    //   overlay started (a working video exists) -> Overlay
    //   else framing started (any clip framed/exported) -> Framing (first clip)
    //   else the earliest applicable stage -> default open (Framing, clip 0)
    if (project.has_working_video) {
      onSelectWithMode({ mode: 'overlay' });
    } else if (project.clips_in_progress > 0 || project.clips_exported > 0) {
      onSelectWithMode({ mode: 'framing', clipIndex: 0 });
    } else {
      onSelect();
    }
  };

  // Keyboard activation (item 3): the tile is a real button-like target, so Enter
  // and Space activate it. handleCardClick owns the ready-state branch (Preview),
  // so keyboard and pointer stay in lockstep.
  const handleCardKeyDown = (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if (isRenaming) return;
    e.preventDefault();
    handleCardClick();
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

  // T8350: multi-clip staleness cue -- badge-only carrier for the produced/ready
  // states, where the strip below is collapsed or suppressed (see reelStaleness.js).
  // Scoped to multi-clip tiles (decision 3a) so it never duplicates Annotate's
  // single-clip staleness signal (T8070).
  const staleCount = project.clip_count > 1 ? staleClipCount(project.clips) : 0;

  // T8320: source-video expiry chip, mirroring the Games tab (GameTile) so a
  // draft whose source game is expired/reclaimed or expiring soon is not
  // indistinguishable from a healthy one in Reel Drafts. `sourceExpiry` is a
  // pure render-time join computed by ProjectManager from the games list
  // ({ expired, daysLeft } | null) — no persisted state, no store write here.
  const sourceExpired = sourceExpiry?.expired === true;
  const sourceDaysLeft = sourceExpiry?.daysLeft ?? null;
  const sourceNearExpiry = !sourceExpired && sourceDaysLeft !== null && sourceDaysLeft < 14;
  const showSourceExpiryChip = sourceExpired || sourceNearExpiry;
  // Left-column stacking so the chip never lands on the count/Ready badge
  // (top-1.5) or the staleness badge (top-9). staleCount > 0 implies
  // clip_count > 1, so those two are the only cases that occupy the slots above.
  const sourceExpiryTop = staleCount > 0
    ? 'top-[68px]'
    : (isReadyToPublish || project.clip_count > 1) ? 'top-9' : 'top-1.5';

  // T7940: append the owner's profile_id so a URL-keyed cache (CDN/proxy/browser)
  // can never serve one account's poster bytes for another account's same-numbered
  // draft. project.id is a per-profile AUTOINCREMENT (not globally unique); the
  // query param disambiguates. Backend rejects a mismatched profile_id with 403.
  const posterUrl = `${API_BASE}/api/projects/${project.id}/poster.jpg?profile_id=${currentProfile?.id}`;

  // T6420 — inline hover preview (fine pointer only; the hook self-gates on
  // useIsCoarsePointer + prefers-reduced-motion). Prefers the final video; T6441
  // falls back to the working video for "In Overlay" drafts (has_working_video),
  // which already have a real rendered artifact. T6820 adds a third rung: a
  // "Not Started" draft has neither, but its SOURCE clip is streamable via the
  // bounded proxy — clips[0].stream_clip_id (a working_clips.id, populated by the
  // projects payload) yields that URL, and the source-window offsets seek the
  // preview into the clip. Drafts with no streamable source (no stream_clip_id)
  // still show nothing (no error). streamUrl -> null while the full preview modal
  // is open so the inline preview tears down and releases the stream (EPIC: full
  // player opening RELEASES it).
  const firstClip = project.clips?.[0];
  const previewStreamUrl = previewOpenForThisProject
    ? null
    : project.final_video_id
      ? `${API_BASE}/api/downloads/${project.final_video_id}/stream`
      : project.has_working_video
        ? `${API_BASE}/api/projects/${project.id}/working_video/stream`
        : firstClip?.stream_clip_id != null
          ? `${API_BASE}/api/clips/projects/${project.id}/clips/${firstClip.stream_clip_id}/stream`
          : null;
  // T6820: seek/loop the source-clip window only on the source-proxy rung. Final/
  // working previews carry no offsets (the file IS the clip) -> undefined, so
  // TilePreviewVideo keeps its native-loop-from-0 behavior for them.
  const isSourceClipPreview = previewStreamUrl != null
    && !project.final_video_id && !project.has_working_video;
  const preview = useTilePreview({ streamUrl: previewStreamUrl });
  const previewStartTime = isSourceClipPreview ? firstClip?.source_start_time : undefined;
  const previewEndTime = isSourceClipPreview ? firstClip?.source_end_time : undefined;

  const gameClock = formatGameClock(project.clip_game_start_time);
  // Q4: one tag chip, only on wider (>=sm) tiles — dropped on narrow mobile tiles.
  const firstTag = project.is_auto_created ? project.clips?.[0]?.tags?.[0] : null;

  // Short status label + tint for the corner chip (Q7: kept alongside the slim
  // progress strip). Mirrors the old metadata-row status logic, condensed to one word.
  let statusLabel = 'Draft';
  let statusTint = 'text-gray-200';
  if (isComplete) { statusLabel = 'Done'; statusTint = 'text-green-300'; }
  else if (isWaitingForUpload) { statusLabel = 'Uploading'; statusTint = 'text-amber-300'; }
  else if (isExporting && isOffline) { statusLabel = 'Offline'; statusTint = 'text-gray-300'; }
  else if (isExporting) { statusLabel = 'Exporting'; statusTint = 'text-amber-300'; }
  else if (failedExportType) { statusLabel = 'Failed'; statusTint = 'text-orange-300'; }
  else if (project.has_working_video) { statusLabel = 'In Overlay'; statusTint = 'text-blue-300'; }
  else if (project.clips_in_progress > 0) { statusLabel = 'Focus'; statusTint = 'text-blue-300'; }
  else if (project.clips_exported > 0) { statusLabel = 'Exported'; statusTint = 'text-gray-200'; }

  // Fine pointer reveals actions on hover; coarse pointer reveals on long-press (actionsRevealed).
  const actionsVisibility = isCoarsePointer
    ? (actionsRevealed ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none')
    : 'opacity-0 pointer-events-none group-hover/tile:opacity-100 group-hover/tile:pointer-events-auto';
  const actionBtnClass = 'coarse-pointer:min-h-[44px] coarse-pointer:min-w-[44px]';

  // Per-reel aspect (mirrors ReelTile T5673): 9:16 drafts render portrait
  // tiles, 16:9 drafts render landscape tiles. A caller that puts both
  // aspects in one row (rare) will get mixed tile heights -- callers should
  // split into one-aspect-per-row instead (see ProjectManager grouping).
  // T6800/T6900: a draft renders at SOURCE aspect (landscape), not the target
  // ratio, until real framing has been applied -- its poster is a landscape
  // source frame (ensure_draft_poster preserves source aspect), so the 9:16
  // shell was center-cropping a sliver of footage the user never cropped. This
  // covers both Not-Started drafts (T6800) and In-Framing drafts that entered
  // the Framing screen but have no crop keyframes yet (T6900) -- see
  // rendersSourceAspect, the shared half of the row-height invariant.
  const isLandscape = project.aspect_ratio === RATIO.LANDSCAPE || rendersSourceAspect(project);
  const sizeClass = isLandscape
    ? 'w-[72vw] max-w-[300px] sm:w-[260px] aspect-video'
    : 'w-[40vw] max-w-[200px] sm:w-[168px] aspect-[9/16]';

  // Kebab overflow items (ready state). ONE renderer feeds both the coarse-pointer
  // sheet and the fine-pointer popover so they can never diverge. Conditions match
  // the old hover rail exactly — presentation moved, behaviour unchanged (T6180).
  const menuItemClass = 'w-full flex items-center gap-3 px-3 py-2.5 text-sm text-left rounded-md transition-colors disabled:opacity-50';
  const renderKebabItems = () => (
    <>
      <button onClick={(e) => { handleStartRename(e); setMenuOpen(false); }} className={`${menuItemClass} hover:bg-gray-600`}>
        <Pencil size={18} className="text-gray-300 flex-shrink-0" />
        <span className="text-gray-200">Rename</span>
      </button>
      {isComplete && (
        <button onClick={(e) => { e.stopPropagation(); handleClipClick(0); setMenuOpen(false); }} className={`${menuItemClass} hover:bg-gray-600`}>
          <Crop size={18} className="text-gray-300 flex-shrink-0" />
          <span className="text-gray-200">Open in Focus</span>
        </button>
      )}
      {isComplete && (
        <button onClick={(e) => { e.stopPropagation(); handleOverlayClick(); setMenuOpen(false); }} className={`${menuItemClass} hover:bg-gray-600`}>
          <Layers size={18} className="text-gray-300 flex-shrink-0" />
          <span className="text-gray-200">Open in Overlay</span>
        </button>
      )}
      {isComplete && !isReadyToPublish && (
        <button onClick={(e) => { handleHideFromDrafts(e); setMenuOpen(false); }} disabled={isPublishing} className={`${menuItemClass} hover:bg-gray-600`}>
          <EyeOff size={18} className="text-gray-300 flex-shrink-0" />
          <span className="text-gray-200">Hide from Drafts</span>
        </button>
      )}
      <div className="my-1 border-t border-gray-600" />
      {/* Two-click delete: first click arms the confirm and KEEPS the menu open; the
          second calls onDelete and the tile unmounts. Never closes on the first tap. */}
      <button onClick={(e) => { e.stopPropagation(); handleDelete(e); }} className={`${menuItemClass} hover:bg-red-900/40`}>
        <Trash2 size={18} className="text-red-400 flex-shrink-0" />
        <span className="text-red-400">{showDeleteConfirm ? 'Click again to confirm' : 'Delete reel'}</span>
      </button>
    </>
  );

  return (
    <div
      data-testid="project-card"
      onClick={handleCardClick}
      onKeyDown={handleCardKeyDown}
      onTouchStart={isCoarsePointer && !isReadyToPublish ? handleTouchStart : undefined}
      onTouchMove={isCoarsePointer && !isReadyToPublish ? handleTouchMove : undefined}
      onTouchEnd={isCoarsePointer && !isReadyToPublish ? handleTouchEnd : undefined}
      onPointerEnter={preview.onPointerEnter}
      onPointerLeave={preview.onPointerLeave}
      role="button"
      tabIndex={canOpen ? 0 : -1}
      aria-current={isCurrentProject ? 'true' : undefined}
      className={`group/tile relative shrink-0 snap-start ${sizeClass} rounded-lg overflow-hidden bg-gray-800 border transition-all duration-150 outline-none
        focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900 focus-visible:border-cyan-400 focus-visible:z-10 ${
        canOpen
          ? `cursor-pointer hover:scale-[1.03] hover:z-10 hover:brightness-105 hover:shadow-lg hover:shadow-cyan-900/40 hover:border-cyan-400 hover:ring-2 hover:ring-cyan-400/60 ${
              isCurrentProject
                ? 'border-cyan-400 ring-2 ring-cyan-400/70 ring-offset-2 ring-offset-gray-900'
                : 'border-gray-700'
            }`
          : 'cursor-not-allowed border-gray-700 opacity-75'
      }`}
    >
      {/* Poster image (lazy — 13+ tiles must not fire eager requests); fades in on load */}
      {posterState !== 'error' && (
        <img
          src={posterUrl}
          alt=""
          loading="lazy"
          onLoad={() => setPosterState('loaded')}
          onError={() => setPosterState('error')}
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-500 ${
            posterState === 'loaded' ? 'opacity-100' : 'opacity-0'
          }`}
        />
      )}
      {/* Skeleton shimmer while the poster loads (item 5 — not the branded fallback) */}
      {posterState === 'loading' && (
        <div className="absolute inset-0 skeleton-shimmer" />
      )}
      {/* Branded fallback on 404 / decode error (no broken image) */}
      {posterState === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-2 bg-gradient-to-br from-cyan-900 via-gray-800 to-gray-900">
          <Film size={26} className="text-cyan-300/80" />
          <span className="text-[11px] text-gray-200 text-center line-clamp-3 px-1">{getProjectDisplayName(project)}</span>
        </div>
      )}

      {/* T6420 inline hover preview — layered directly above the poster (implicit
          z-0), below the scrim (z-10)/badges/actions/kebab. pointer-events-none so
          the T5910 hover action reveal keeps working over the playing video. Only
          rendered when a rendered final video exists; allowed on branded-fallback
          tiles too. */}
      {previewStreamUrl && (
        <TilePreviewVideo
          streamUrl={previewStreamUrl}
          phase={preview.phase}
          onContentReady={preview.onContentReady}
          startTime={previewStartTime}
          endTime={previewEndTime}
        />
      )}

      {/* Multi-clip marker — only shown when the draft has more than 1 clip. On a
          ready tile the top-left hosts the "Ready" badge, so the count shifts to the
          top-right corner freed by the suppressed status chip (T6180). */}
      {project.clip_count > 1 && (
        <span
          className={`absolute top-1.5 z-20 inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-semibold bg-gray-900/80 text-white shadow backdrop-blur-sm ${
            isReadyToPublish ? 'right-1.5' : 'left-1.5'
          }`}
          title={`Contains ${project.clip_count} clips`}
          aria-label={`Contains ${project.clip_count} clips`}
        >
          <Layers size={12} />
          {project.clip_count}
        </span>
      )}

      {/* "Ready to share" is a STATUS, not a control (T6180): a non-interactive
          badge. The publish gesture is the primary button in the bottom action
          bar. T8470 qualifies the bare "Ready" (it had a final video but was not
          yet shared) so it can never read as the ambiguous lifecycle word. */}
      {isReadyToPublish && (
        <span
          className="absolute top-1.5 left-1.5 z-20 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-black/60 backdrop-blur-sm text-cyan-300 shadow"
        >
          <CheckCircle size={11} />
          Ready to share
        </span>
      )}

      {/* Status chip (Q7) — suppressed in the ready state (Q1): a ready tile shows
          only the top-left "Ready to share" badge. Every other state is byte-for-byte unchanged. */}
      {!isReadyToPublish && (
        <span className={`absolute top-1.5 right-1.5 z-20 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-black/60 backdrop-blur-sm ${statusTint}`}>
          {statusLabel}
        </span>
      )}

      {/* In-My-Reels marker for published-complete reels */}
      {isComplete && project.is_published && (
        <span className="absolute top-9 right-1.5 z-20 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] bg-black/60 backdrop-blur-sm text-cyan-300" title={`In ${SECTION_NAMES.LIBRARY}`}>
          <CheckCircle size={11} />
        </span>
      )}

      {/* T8350: multi-clip staleness badge — the PRIMARY cue, since it's the only
          one visible in the produced/ready states where the strip below is
          collapsed or suppressed. Stacks under the count/Ready pill (left column
          is the only slot free in every tile state). */}
      {staleCount > 0 && (
        <span
          className="absolute top-9 left-1.5 z-20 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/90 text-gray-950 shadow backdrop-blur-sm"
          title={staleCount === 1
            ? '1 clip changed since this reel was made — re-export to update it'
            : `${staleCount} clips changed since this reel was made — re-export to update them`}
          aria-label={`${staleCount} ${staleCount === 1 ? 'clip' : 'clips'} changed since this reel was made`}
        >
          <AlertTriangle size={11} />
          {staleCount} outdated
        </span>
      )}

      {/* T8320: source-video expiry chip — matches GameTile's yellow expiry chip
          (Clock + "Expired"/"Nd") so the same signal reads identically on both
          surfaces. Shown when a source game is expired/reclaimed, or the nearest
          source expiry is under 14 days. Stacked in the left column below any
          count/Ready/staleness badge. */}
      {showSourceExpiryChip && (
        <div
          data-testid="source-expiry-chip"
          className={`absolute ${sourceExpiryTop} left-1.5 z-20 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-yellow-900/70 text-yellow-300`}
          title={sourceExpired
            ? 'Source video expired'
            : `Source video expires in ${sourceDaysLeft} day${sourceDaysLeft === 1 ? '' : 's'}`}
        >
          <Clock size={10} />
          {sourceExpired ? 'Source expired' : `${sourceDaysLeft}d`}
        </div>
      )}

      {/* Bottom scrim: name, game-time, one tag (>=sm). In the ready state the
          persistent action bar owns the base of the tile, so the name lifts clear
          of it (T6180); otherwise the compact pb-3 is unchanged. */}
      <div
        className="absolute inset-x-0 bottom-0 z-10 px-2 pt-8 pb-3 bg-gradient-to-t from-black/85 via-black/45 to-transparent"
        hidden={isReadyToPublish && !isRenaming}
      >
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
          // T6890: the rename pencil sits directly beside the name it edits (it
          // used to be stacked in the top-right hover rail with Preview/Crop/Layers/
          // Hide/Delete, so nothing tied it to the name). Discoverable at rest per
          // the CardNameInput / ManageProfilesModal reference pattern; brightens on
          // hover, 44px tap target on coarse pointers.
          <div className="flex items-start gap-1">
            <h3 className="flex-1 min-w-0 text-white text-xs font-medium leading-tight line-clamp-2 drop-shadow">
              {getProjectDisplayName(project)}
            </h3>
            <button
              type="button"
              onClick={handleStartRename}
              title="Rename reel"
              aria-label="Rename reel"
              className="flex-shrink-0 inline-flex items-center justify-center rounded text-gray-300 hover:text-white transition-colors min-h-[32px] min-w-[32px] coarse-pointer:min-h-[44px] coarse-pointer:min-w-[44px]"
            >
              <Pencil size={14} />
            </button>
          </div>
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

      {/* Slim progress strip pinned to the base (Q7 deep-link stays clickable).
          Dropped in the ready state (Q2): that band becomes the action bar below. */}
      {!isReadyToPublish && (
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
      )}

      {/* Non-ready actions — desktop hover / mobile long-press sheet. Every old card
          action reachable. The ready state has its own persistent bar + kebab below,
          so this hover rail is suppressed there (T6180). */}
      {!isReadyToPublish && (
        <div data-testid="tile-actions" className={`absolute top-9 right-1.5 z-30 flex flex-col items-end gap-1 transition-opacity ${actionsVisibility}`}>
          {isComplete && project.final_video_id && (
            <Button variant="secondary" size="sm" icon={Play} iconOnly onClick={(e) => { e.stopPropagation(); openFinishedReel(project); }} title="Preview video" className={actionBtnClass} />
          )}
          {/* T6890: the rename pencil moved OUT of this rail to sit beside the name
              in the bottom scrim (above). It is no longer stacked here. */}
          {isComplete && (
            <Button variant="secondary" size="sm" icon={Crop} iconOnly onClick={(e) => { e.stopPropagation(); handleClipClick(0); }} title="Open in Focus" className={actionBtnClass} />
          )}
          {isComplete && (
            <Button variant="secondary" size="sm" icon={Layers} iconOnly onClick={(e) => { e.stopPropagation(); handleOverlayClick(); }} title="Open in Overlay" className={actionBtnClass} />
          )}
          {isComplete && !isReadyToPublish && (
            <Button variant="secondary" size="sm" icon={EyeOff} iconOnly loading={isPublishing} onClick={handleHideFromDrafts} title={`Hide from Drafts (stays in ${SECTION_NAMES.LIBRARY})`} className={actionBtnClass} />
          )}
          <Button variant={showDeleteConfirm ? 'danger' : 'secondary'} size="sm" icon={Trash2} iconOnly onClick={handleDelete} title={showDeleteConfirm ? 'Click again to confirm' : 'Delete reel'} className={actionBtnClass} />
        </div>
      )}

      {/* READY-STATE overflow kebab — corner-anchored, NOT welded to a CTA.
          Matches GameTile's kebab exactly (top-right, circular, black/60 +
          backdrop-blur, hover-reveal on fine pointers, always-on for touch) so the
          two tile families share one "more actions" convention. Overflow is chrome;
          it is not a peer of the call to action, which is why it does not live in
          the action bar. */}
      {isReadyToPublish && !isRenaming && (
        <button
          ref={kebabBtnRef}
          type="button"
          onClick={(e) => { e.stopPropagation(); setMenuOpen((o) => !o); }}
          title="More actions"
          aria-label="More actions"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          className={`absolute top-1.5 right-1.5 z-40 inline-flex items-center justify-center rounded-full bg-black/60 backdrop-blur-sm text-white hover:bg-black/80 min-h-[32px] min-w-[32px] coarse-pointer:min-h-[44px] coarse-pointer:min-w-[44px] transition-opacity ${
            isCoarsePointer
              ? 'opacity-100'
              : 'opacity-0 group-hover/tile:opacity-100 focus:opacity-100'
          } ${menuOpen ? 'opacity-100' : ''}`}
        >
          <MoreVertical size={16} />
        </button>
      )}

      {/* READY-STATE action bar (T6180): a PERSISTENT bar — the whole point is that
          the primary action is always visible, never hover-gated. Two full-width
          buttons of identical shape read as one deliberate CTA pair rather than
          controls scattered on a gradient. Hidden while renaming so the name input
          (in the scrim above) is reachable. */}
      {isReadyToPublish && !isRenaming && (
        <div
          data-testid="ready-actions"
          className="absolute inset-x-0 bottom-0 z-30 flex flex-col gap-1 px-1.5 pb-1.5 pt-10 bg-gradient-to-t from-black via-black/85 to-transparent"
        >
          {/* Metadata lives INSIDE this block, in normal flow directly above the
              CTAs. Previously the scrim was a second absolutely-positioned layer
              clearing the bar with a hardcoded pb-[96px] — a magic number guessing
              the bar's height, which is why the name/clock floated at an unrelated
              offset and the two gradients double-darkened where they overlapped. */}
          <div className="px-0.5 pb-0.5">
            <h3 className="text-white text-xs font-medium leading-tight line-clamp-2 drop-shadow">
              {getProjectDisplayName(project)}
            </h3>
            {(gameClock || firstTag) && (
              <div className="mt-1 flex items-center gap-1.5 flex-nowrap overflow-hidden">
                {gameClock && (
                  <span className="shrink-0 text-[11px] leading-none text-gray-300" title="Game time">{gameClock}</span>
                )}
                {firstTag && (
                  <span className="hidden sm:inline-flex shrink-0 items-center gap-0.5 px-1 py-0.5 text-[10px] leading-none rounded bg-white/10 text-cyan-200">
                    <Tag size={9} />
                    <span className="truncate max-w-[80px]">{firstTag}</span>
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Primary — names the verb, carries the accent + lift. AA contrast: gray-950 on cyan-500. */}
          <button
            type="button"
            onClick={handlePublishToMyReels}
            disabled={isPublishing}
            aria-label={`Publish to ${SECTION_NAMES.LIBRARY}`}
            title={`Publish to ${SECTION_NAMES.LIBRARY}`}
            className="w-full inline-flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg text-[11px] font-semibold tracking-tight bg-cyan-500 text-gray-950 shadow-lg shadow-cyan-500/25 hover:bg-cyan-400 active:scale-[0.98] disabled:opacity-60 transition-all coarse-pointer:min-h-[44px]"
          >
            {isPublishing ? <Loader2 size={14} className="animate-spin" /> : <FolderInput size={14} />}
            Publish
          </button>
          {/* Secondary — same footprint as the primary so they pair; outlined rather
              than a translucent slab, so it reads as a button and not as scrim. */}
          {project.final_video_id && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); openFinishedReel(project); }}
              title="Preview video"
              aria-label="Preview video"
              className="w-full inline-flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg text-[11px] font-medium bg-white/10 ring-1 ring-inset ring-white/25 backdrop-blur-sm text-white hover:bg-white/20 hover:ring-white/40 active:scale-[0.98] transition-all coarse-pointer:min-h-[44px]"
            >
              <Play size={14} />
              Preview
            </button>
          )}
        </div>
      )}

      {/* Kebab menu (ready state) — coarse-pointer bottom sheet OR fine-pointer
          portaled popover. renderKebabItems() is the single source for both so the
          two shells never drift. Delete is two-click and deliberately keeps the menu
          OPEN on the first click (a menu that closed would swallow the confirm). */}
      {menuOpen && (isCoarsePointer ? (
        <div ref={menuRef} className="fixed inset-0 z-50 flex flex-col" onClick={(e) => e.stopPropagation()}>
          <div className="flex-1 bg-black/40" onClick={() => setMenuOpen(false)} />
          <div data-testid="draft-kebab-menu" className="bg-gray-800 rounded-t-2xl border-t border-gray-700 max-h-[70vh] overflow-y-auto">
            <div className="flex items-center justify-center pt-2 pb-1">
              <div className="h-1 w-10 bg-gray-600 rounded-full" />
            </div>
            <div className="px-2 py-2">
              {renderKebabItems()}
            </div>
          </div>
        </div>
      ) : menuPos ? (
        createPortal(
          <div
            ref={menuRef}
            data-testid="draft-kebab-menu"
            className={`fixed bg-gray-700 border border-gray-600 rounded-lg shadow-xl ${Z.MODAL} w-48 py-1`}
            style={{ top: `${menuPos.top}px`, left: `${Math.max(8, menuPos.left)}px` }}
            onClick={(e) => e.stopPropagation()}
          >
            {renderKebabItems()}
          </div>,
          document.body
        )
      ) : null)}

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

    </div>
  );
}

export default DraftTile;
