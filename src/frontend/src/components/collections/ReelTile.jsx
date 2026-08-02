import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  Play, Share2, Link2, MoreVertical, Download, Loader, Columns,
  FolderOpen, ArrowRightLeft, Trash2, Pencil, Film,
} from 'lucide-react';
import { RATIO } from '../../constants/aspectRatios';
import { REEL } from '../../config/themeColors';
import { useIsCoarsePointer } from '../../hooks/useIsMobile';

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
 * owns only ephemeral UI state (poster load, kebab open, inline rename).
 *
 * Persistent actions (T6300): a hover-gated cluster made every action — including
 * the kebab — invisible until the tile was hovered, and `isMobile` (a UA sniff from
 * useWebShare) misdetected touch-Windows as desktop, wiring long-press (the
 * hover replacement) only for "mobile" -> a functional dead end on that hardware.
 * Fixed by splitting into two independently-placed, ALWAYS-MOUNTED chips: a
 * persistent Play (bottom-left, never hover-gated - a published reel's natural
 * primary) and a corner kebab (top-right, DraftTile's exact visibility formula:
 * hover/focus-revealed on fine pointers, always opacity-100 on coarse pointers via
 * the live useIsCoarsePointer() matchMedia - no long-press, no dead end). The
 * inline Copy/Share chip is absorbed into the kebab per the T6180 house rule
 * "main button + kebab for the rest" — BOTH Share and Copy Link now live in
 * BOTH menu shells (the desktop popover already listed both; the mobile sheet
 * previously only got Web Share via the removed inline chip, so a "Share" item
 * was added there too — dropping it would have silently removed native-share
 * reachability on touch). Since both items are always listed, the `isMobile`
 * prop this component used to take (for the Share-vs-Copy-link choice) is no
 * longer needed and was dropped, along with DownloadsPanel's now-dead
 * `useWebShare().isMobile` read that only fed it.
 *
 * Kebab menu (T5673 redesign): rendered via createPortal to document.body, fixed-
 * position anchored to button rect, flips upward when near viewport bottom. Desktop
 * renders w-48 right-aligned popover with icons + full labels, groups + separators.
 * Coarse pointers open a bottom action sheet instead (existing pattern) - now
 * selected by isCoarsePointer, not the isMobile UA sniff.
 */
export function ReelTile({
  download,
  posterUrl,
  isUnwatched,
  unwatchedStyle,
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
  seasonRank,
}) {
  // Poster load lifecycle: 'loading' -> skeleton shimmer; 'loaded' -> poster;
  // 'error' -> branded fallback (the endpoint 404s when no poster exists).
  const [posterState, setPosterState] = useState('loading');
  const [menuOpen, setMenuOpen] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [menuPos, setMenuPos] = useState(null); // {top, left, flipped} for portal
  const menuRef = useRef(null);
  const kebabBtnRef = useRef(null);
  // T6300: reveal/interaction gate is CAPABILITY (pointer type), not the isMobile
  // UA-sniff prop — a live matchMedia so a touch-Windows device is correctly
  // detected as coarse instead of falling into the (dead-end) desktop hover path.
  const isCoarsePointer = useIsCoarsePointer();

  const isLandscape = download.aspect_ratio === RATIO.LANDSCAPE;
  // Landscape tiles are wider + shorter; portrait match DraftTile's footprint.
  const sizeClass = isLandscape
    ? 'w-[72vw] max-w-[300px] sm:w-[260px] aspect-video'
    : 'w-[42vw] max-w-[168px] sm:w-[150px] aspect-[9/16]';

  useEffect(() => {
    if (!menuOpen || !kebabBtnRef.current) {
      setMenuPos(null);
      return;
    }

    const updatePosition = () => {
      const rect = kebabBtnRef.current.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const menuHeight = 300; // approximate; actual is measured
      const flipped = rect.bottom + menuHeight > viewportHeight;

      setMenuPos({
        top: flipped ? rect.top - menuHeight : rect.bottom + 4,
        left: rect.right - 192, // w-48 = 192px, right-aligned
        flipped,
      });
    };

    updatePosition();
    const resizeListener = () => updatePosition();
    window.addEventListener('resize', resizeListener);

    const onOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target) && !kebabBtnRef.current.contains(e.target)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onOutside);
    document.addEventListener('touchstart', onOutside);

    return () => {
      window.removeEventListener('resize', resizeListener);
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

  const actionBtnClass = 'inline-flex items-center justify-center rounded-full bg-black/60 backdrop-blur-sm text-white hover:bg-black/80 transition-colors coarse-pointer:min-h-[44px] coarse-pointer:min-w-[44px] min-h-[32px] min-w-[32px]';
  const menuItemClass = 'w-full flex items-center gap-3 px-4 py-3 text-sm text-left hover:bg-gray-600 transition-colors disabled:opacity-50';

  return (
    <div
      data-testid="reel-card"
      className={`group/tile relative shrink-0 snap-start rounded-lg overflow-hidden bg-gray-800 border transition-all duration-150
        hover:scale-[1.03] hover:z-10 hover:brightness-105 hover:shadow-lg hover:shadow-cyan-900/40 hover:ring-2 hover:ring-cyan-400/60 ${sizeClass} ${
        isUnwatched ? unwatchedStyle.border : `border-gray-700 hover:border-cyan-400`
      }`}
    >
      {/* Poster (lazy — a carousel of many tiles must not fire eager requests); fades in on load */}
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
      {posterState === 'loading' && <div className="absolute inset-0 skeleton-shimmer" />}
      {posterState === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-2 bg-gradient-to-br from-cyan-900 via-gray-800 to-gray-900">
          <Film size={26} className="text-cyan-300/80" />
          <span className="text-[11px] text-gray-200 text-center line-clamp-3 px-1">{displayName}</span>
        </div>
      )}

      {/* Unwatched (NEW) dot — shifted left of the persistent kebab (T6300) so the
          two top-right occupants stack instead of overlapping (design doc §2.2). */}
      {isUnwatched && (
        <span className={`absolute top-2.5 right-11 z-20 w-3 h-3 rounded-full ${unwatchedStyle.dot} ring-2 ring-black/40`} title="New" />
      )}

      {/* Top Play rank badge (T5679) */}
      {seasonRank && seasonRank <= 20 && (
        <div
          className="absolute top-1.5 left-1.5 z-20 px-2 py-0.5 bg-cyan-500/90 text-black text-xs font-bold rounded-md"
          title={`Ranked #${seasonRank} of your reels this season`}
          aria-label={`Ranked #${seasonRank} of your reels this season`}
        >
          #{seasonRank}
        </div>
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

      {/* Persistent primary — Play. Always visible, never hover-gated (T6300):
          discovering that a reel HAS actions must not require hovering it. */}
      {!isRenaming && (
        <button
          type="button"
          onClick={(e) => onPlay(e, download)}
          title="Play video"
          aria-label="Play video"
          className={`absolute bottom-1.5 left-1.5 z-30 ${actionBtnClass}`}
        >
          <Play size={16} className={REEL.accent} />
        </button>
      )}

      {/* Overflow kebab — corner-anchored, always mounted. Copies DraftTile's
          visibility formula exactly (T6300): persistent on coarse pointers (fixes
          the touch-Windows dead end — no hover, no long-press needed), hover/
          focus-revealed on fine pointers but in a fixed discoverable corner. Copy
          link / Share (previously an inline chip) now live in this menu. */}
      <button
        ref={kebabBtnRef}
        type="button"
        onClick={(e) => { e.stopPropagation(); setMenuOpen((o) => !o); }}
        title="More actions"
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        className={`absolute top-1.5 right-1.5 z-40 ${actionBtnClass} transition-opacity ${
          isCoarsePointer
            ? 'opacity-100'
            : 'opacity-0 group-hover/tile:opacity-100 focus:opacity-100'
        } ${menuOpen ? 'opacity-100' : ''}`}
      >
        <MoreVertical size={16} />
      </button>
      {menuOpen && isCoarsePointer ? (
          <div ref={menuRef} className="fixed inset-0 z-50 flex flex-col">
            <div className="flex-1 bg-black/40" onClick={() => setMenuOpen(false)} />
            <div className="bg-gray-800 rounded-t-2xl border-t border-gray-700 max-h-[70vh] overflow-y-auto">
              <div className="flex items-center justify-center pt-2 pb-1">
                <div className="h-1 w-10 bg-gray-600 rounded-full" />
              </div>
              <div className="space-y-1 px-4 py-3">
                <button onClick={(e) => { onDownload(e, download); setMenuOpen(false); }} disabled={downloadingId === download.id} className="w-full flex items-center gap-3 px-4 py-3 text-sm text-left hover:bg-gray-700 rounded-lg transition-colors">
                  {downloadingId === download.id
                    ? <Loader size={20} className="text-gray-400 animate-spin flex-shrink-0" />
                    : <Download size={20} className="text-gray-300 flex-shrink-0" />}
                  <span className="text-gray-200">Download</span>
                </button>
                {/* T6300: the removed inline chip was the only mobile path to
                    onWebShare (native share sheet) — restored here so coarse
                    pointers keep that capability, not just Copy Link. */}
                <button onClick={(e) => { onWebShare(e, download); setMenuOpen(false); }} className="w-full flex items-center gap-3 px-4 py-3 text-sm text-left hover:bg-gray-700 rounded-lg transition-colors">
                  <Share2 size={20} className="text-gray-300 flex-shrink-0" />
                  <span className="text-gray-200">Share</span>
                </button>
                <button onClick={(e) => { onCopyLink(e, download); setMenuOpen(false); }} className="w-full flex items-center gap-3 px-4 py-3 text-sm text-left hover:bg-gray-700 rounded-lg transition-colors">
                  <Link2 size={20} className="text-gray-300 flex-shrink-0" />
                  <span className="text-gray-200">Copy Link</span>
                </button>
                <button onClick={startRename} className="w-full flex items-center gap-3 px-4 py-3 text-sm text-left hover:bg-gray-700 rounded-lg transition-colors">
                  <Pencil size={20} className="text-gray-300 flex-shrink-0" />
                  <span className="text-gray-200">Rename</span>
                </button>
                {showBeforeAfter && (
                  <>
                    <div className="my-1 border-t border-gray-700" />
                    <button onClick={(e) => { onBeforeAfter(e, download); setMenuOpen(false); }} disabled={exportingBeforeAfter === download.id} className="w-full flex items-center gap-3 px-4 py-3 text-sm text-left hover:bg-gray-700 rounded-lg transition-colors">
                      {exportingBeforeAfter === download.id
                        ? <Loader size={20} className="text-blue-400 animate-spin flex-shrink-0" />
                        : <Columns size={20} className="text-blue-400 flex-shrink-0" />}
                      <span className="text-gray-200">Before / After</span>
                    </button>
                  </>
                )}
                {canOpenSource(download) && (
                  <button onClick={(e) => { onOpenProject(e, download); setMenuOpen(false); }} disabled={restoringId === download.id} className="w-full flex items-center gap-3 px-4 py-3 text-sm text-left hover:bg-gray-700 rounded-lg transition-colors">
                    {restoringId === download.id
                      ? <Loader size={20} className="text-gray-300 animate-spin flex-shrink-0" />
                      : <FolderOpen size={20} className="text-gray-300 flex-shrink-0" />}
                    <span className="text-gray-200">Open as Draft</span>
                  </button>
                )}
                {canMoveProfiles && (
                  <button onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onMove(download); }} className="w-full flex items-center gap-3 px-4 py-3 text-sm text-left hover:bg-gray-700 rounded-lg transition-colors">
                    <ArrowRightLeft size={20} className="text-gray-300 flex-shrink-0" />
                    <span className="text-gray-200">Move to profile…</span>
                  </button>
                )}
                <div className="my-1 border-t border-gray-700" />
                <button onClick={(e) => { onDelete(e, download); setMenuOpen(false); }} className="w-full flex items-center gap-3 px-4 py-3 text-sm text-left hover:bg-red-900/40 rounded-lg transition-colors">
                  <Trash2 size={20} className="text-red-400 flex-shrink-0" />
                  <span className="text-red-400">Delete</span>
                </button>
              </div>
            </div>
          </div>
        ) : menuOpen && menuPos ? (
          createPortal(
            <div
              ref={menuRef}
              className="fixed bg-gray-700 border border-gray-600 rounded-lg shadow-xl z-50 w-48 py-1"
              style={{
                top: `${menuPos.top}px`,
                left: `${Math.max(8, menuPos.left)}px`,
              }}
            >
              <button onClick={(e) => { onDownload(e, download); setMenuOpen(false); }} disabled={downloadingId === download.id} className={menuItemClass}>
                {downloadingId === download.id
                  ? <Loader size={18} className="text-gray-400 animate-spin flex-shrink-0" />
                  : <Download size={18} className="text-gray-300 flex-shrink-0" />}
                <span className="text-gray-200">Download</span>
              </button>
              <button onClick={(e) => { onWebShare(e, download); setMenuOpen(false); }} className={menuItemClass}>
                <Share2 size={18} className="text-gray-300 flex-shrink-0" />
                <span className="text-gray-200">Share</span>
              </button>
              <button onClick={(e) => { onCopyLink(e, download); setMenuOpen(false); }} className={menuItemClass}>
                <Link2 size={18} className="text-gray-300 flex-shrink-0" />
                <span className="text-gray-200">Copy Link</span>
              </button>
              <div className="my-1 border-t border-gray-600" />
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
              <div className="my-1 border-t border-gray-600" />
              <button onClick={(e) => { onDelete(e, download); setMenuOpen(false); }} className="w-full flex items-center gap-3 px-4 py-3 text-sm text-left hover:bg-red-900/40 transition-colors">
                <Trash2 size={18} className="text-red-400 flex-shrink-0" />
                <span className="text-red-400">Delete</span>
              </button>
            </div>,
            document.body
          )
        ) : null}
    </div>
  );
}

export default ReelTile;
