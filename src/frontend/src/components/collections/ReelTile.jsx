import { useState, useRef, useEffect } from 'react';
import {
  Play, Share2, Link2, MoreVertical, Download, Loader, Columns,
  FolderOpen, ArrowRightLeft, Trash2, Pencil, Film,
} from 'lucide-react';
import { RATIO } from '../../constants/aspectRatios';
import { REEL } from '../../config/themeColors';

/**
 * ReelTile - a PUBLISHED reel as a poster tile (T5673).
 *
 * The celebration-surface counterpart to DraftTile: same poster idiom (lazy image
 * -> skeleton -> branded fallback, bottom scrim, hover/long-press actions) but with
 * NO draft-progress chrome (published reels have no Framing/Overlay pipeline). The
 * poster is the T5280 publish poster, served per-profile from the owner endpoint
 * GET /api/downloads/{id}/poster.jpg (404 -> branded fallback; never a broken image).
 *
 * Per-reel aspect (approved spec Q4): 9:16 reels render portrait tiles, 16:9 reels
 * render landscape tiles. A ratio-collection carousel holds one ratio, so tiles in a
 * row share an aspect — heights stay consistent within a row.
 *
 * View-only: every action is a handler passed down from DownloadsPanel; this tile
 * owns only ephemeral UI state (poster load, kebab open, inline rename, long-press).
 */
export function ReelTile({
  download,
  posterUrl,
  isUnwatched,
  unwatchedStyle,
  isMobile,
  displayName,
  metaLine,
  // actions (all take the download, wired in the panel)
  onPlay,
  onWebShare,
  onCopyLink,
  onDownload,
  downloadingId,
  onBeforeAfter,
  exportingBeforeAfter,
  showBeforeAfter,
  onOpenProject,
  canOpenSource,
  restoringId,
  onMove,
  canMoveProfiles,
  onDelete,
  onRename,
}) {
  // Poster load lifecycle: 'loading' -> skeleton shimmer; 'loaded' -> poster;
  // 'error' -> branded fallback (the endpoint 404s when no poster exists).
  const [posterState, setPosterState] = useState('loading');
  const [menuOpen, setMenuOpen] = useState(false);
  const [actionsRevealed, setActionsRevealed] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const menuRef = useRef(null);
  const longPressTimer = useRef(null);
  const longPressFired = useRef(false);

  const isLandscape = download.aspect_ratio === RATIO.LANDSCAPE;
  // Landscape tiles are wider + shorter; portrait match DraftTile's footprint.
  const sizeClass = isLandscape
    ? 'w-[72vw] max-w-[300px] sm:w-[260px] aspect-video'
    : 'w-[42vw] max-w-[168px] sm:w-[150px] aspect-[9/16]';

  useEffect(() => {
    if (!menuOpen) return;
    const onOutside = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false); };
    document.addEventListener('mousedown', onOutside);
    document.addEventListener('touchstart', onOutside);
    return () => {
      document.removeEventListener('mousedown', onOutside);
      document.removeEventListener('touchstart', onOutside);
    };
  }, [menuOpen]);

  const startRename = () => {
    setRenameValue(download.project_name || '');
    setIsRenaming(true);
    setMenuOpen(false);
  };
  const commitRename = () => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== download.project_name) onRename(download.id, trimmed);
    setIsRenaming(false);
  };

  // Mobile reveals actions on long-press; desktop on hover (group-hover/tile).
  const handleTouchStart = () => {
    longPressFired.current = false;
    longPressTimer.current = setTimeout(() => {
      longPressTimer.current = null;
      longPressFired.current = true;
      setActionsRevealed(true);
    }, 500);
  };
  const clearLongPress = () => {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
  };
  const actionsVisibility = isMobile
    ? (actionsRevealed ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none')
    : 'opacity-0 pointer-events-none group-hover/tile:opacity-100 group-hover/tile:pointer-events-auto';
  const actionBtnClass = 'inline-flex items-center justify-center rounded-full bg-black/60 backdrop-blur-sm text-white hover:bg-black/80 transition-colors coarse-pointer:min-h-[44px] coarse-pointer:min-w-[44px] min-h-[32px] min-w-[32px]';
  const menuItemClass = 'w-full flex items-center gap-3 px-4 py-3 text-sm text-left hover:bg-gray-600 transition-colors disabled:opacity-50';

  return (
    <div
      data-testid="reel-card"
      onTouchStart={isMobile ? handleTouchStart : undefined}
      onTouchMove={isMobile ? clearLongPress : undefined}
      onTouchEnd={isMobile ? clearLongPress : undefined}
      className={`group/tile relative shrink-0 snap-start rounded-lg overflow-hidden bg-gray-800 border transition-colors ${sizeClass} ${
        isUnwatched ? unwatchedStyle.border : `border-gray-700 ${REEL.borderHover}`
      }`}
    >
      {/* Poster (lazy — a carousel of many tiles must not fire eager requests) */}
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
      {posterState === 'loading' && <div className="absolute inset-0 bg-gray-700 animate-pulse" />}
      {posterState === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-2 bg-gradient-to-br from-cyan-900 via-gray-800 to-gray-900">
          <Film size={26} className="text-cyan-300/80" />
          <span className="text-[11px] text-gray-200 text-center line-clamp-3 px-1">{displayName}</span>
        </div>
      )}

      {/* Unwatched (NEW) dot */}
      {isUnwatched && (
        <span className={`absolute top-1.5 right-1.5 z-20 w-3 h-3 rounded-full ${unwatchedStyle.dot} ring-2 ring-black/40`} title="New" />
      )}

      {/* Bottom scrim: name (or rename input) + metadata */}
      <div className="absolute inset-x-0 bottom-0 z-10 px-2 pt-8 pb-2 bg-gradient-to-t from-black/85 via-black/45 to-transparent">
        {isRenaming ? (
          <input
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') commitRename();
              else if (e.key === 'Escape') setIsRenaming(false);
            }}
            onBlur={commitRename}
            className={`w-full text-white text-xs font-medium bg-black/40 border-b ${REEL.border} outline-none`}
          />
        ) : (
          <h3 className="text-white text-xs font-medium leading-tight line-clamp-2 drop-shadow">{displayName}</h3>
        )}
        {metaLine && (
          <div className="mt-0.5 text-[11px] text-gray-300 truncate">{metaLine}</div>
        )}
      </div>

      {/* Actions — play + share direct; kebab for overflow. Hover (desktop) / long-press (mobile). */}
      <div className={`absolute top-1.5 left-1.5 z-30 flex items-center gap-1 transition-opacity ${actionsVisibility}`}>
        <button type="button" onClick={(e) => onPlay(e, download)} title="Play video" aria-label="Play video" className={actionBtnClass}>
          <Play size={16} className={REEL.accent} />
        </button>
        {isMobile ? (
          <button type="button" onClick={(e) => onWebShare(e, download)} title="Share video" aria-label="Share video" className={actionBtnClass}>
            <Share2 size={16} />
          </button>
        ) : (
          <button type="button" onClick={(e) => onCopyLink(e, download)} title="Copy link" aria-label="Copy link" className={actionBtnClass}>
            <Link2 size={16} />
          </button>
        )}
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setMenuOpen((o) => !o); }}
            title="More actions"
            aria-label="More actions"
            className={actionBtnClass}
          >
            <MoreVertical size={16} />
          </button>
          {menuOpen && (
            <div className="absolute left-0 top-full mt-1 bg-gray-700 border border-gray-600 rounded-lg shadow-xl z-50 min-w-[180px] py-1">
              <button onClick={(e) => { onDownload(e, download); setMenuOpen(false); }} disabled={downloadingId === download.id} className={menuItemClass}>
                {downloadingId === download.id
                  ? <Loader size={18} className="text-gray-400 animate-spin flex-shrink-0" />
                  : <Download size={18} className="text-gray-300 flex-shrink-0" />}
                <span className="text-gray-200">Download</span>
              </button>
              {isMobile ? (
                <button onClick={(e) => { onCopyLink(e, download); setMenuOpen(false); }} className={menuItemClass}>
                  <Link2 size={18} className="text-gray-300 flex-shrink-0" />
                  <span className="text-gray-200">Copy Link</span>
                </button>
              ) : (
                <button onClick={(e) => { onWebShare(e, download); setMenuOpen(false); }} className={menuItemClass}>
                  <Share2 size={18} className="text-gray-300 flex-shrink-0" />
                  <span className="text-gray-200">Share</span>
                </button>
              )}
              <button onClick={startRename} className={menuItemClass}>
                <Pencil size={18} className="text-gray-300 flex-shrink-0" />
                <span className="text-gray-200">Rename</span>
              </button>
              {showBeforeAfter && (
                <button onClick={(e) => { onBeforeAfter(e, download); setMenuOpen(false); }} disabled={exportingBeforeAfter === download.id} className={menuItemClass}>
                  {exportingBeforeAfter === download.id
                    ? <Loader size={18} className="text-blue-400 animate-spin flex-shrink-0" />
                    : <Columns size={18} className="text-blue-400 flex-shrink-0" />}
                  <span className="text-gray-200">Before / After</span>
                </button>
              )}
              {canOpenSource(download) && (
                <button onClick={(e) => { onOpenProject(e, download); setMenuOpen(false); }} disabled={restoringId === download.id} className={menuItemClass}>
                  {restoringId === download.id
                    ? <Loader size={18} className="text-gray-300 animate-spin flex-shrink-0" />
                    : <FolderOpen size={18} className="text-gray-300 flex-shrink-0" />}
                  <span className="text-gray-200">Open as Draft</span>
                </button>
              )}
              {canMoveProfiles && (
                <button onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onMove(download); }} className={menuItemClass}>
                  <ArrowRightLeft size={18} className="text-gray-300 flex-shrink-0" />
                  <span className="text-gray-200">Move to profile…</span>
                </button>
              )}
              <button onClick={(e) => { onDelete(e, download); setMenuOpen(false); }} className="w-full flex items-center gap-3 px-4 py-3 text-sm text-left hover:bg-red-900/40 transition-colors">
                <Trash2 size={18} className="text-red-400 flex-shrink-0" />
                <span className="text-red-400">Delete</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default ReelTile;
