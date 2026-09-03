import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Play, Share2, Pencil, RefreshCw, Trash2, Clock, MoreVertical, AlertTriangle } from 'lucide-react';
import { useIsMobile } from '../hooks/useIsMobile';
import { useProfileStore } from '../stores';
import { sportEmojiOrNull } from '../modes/annotate/constants/tagRegistry';
import { formatMatchDateLabel } from '../utils/matchDate';
import { Logo } from './Logo';
import { getDaysUntil } from './ExpirationBadge';
import { API_BASE } from '../config';

/**
 * GameTile - Landscape (16:9) poster tile for games in the games tab grid (T5681).
 *
 * Presents a game as a landscape tile with:
 * - Poster image (recap or live-source poster) or a SPORT-AWARE branded fallback
 *   (the current profile's sport ball; unknown/custom sport -> the app logo, never
 *   another sport's ball).
 * - Minimal overlay: date + annotation count (and published reel count, T8260)
 * - Expiry chip (if near/expired)
 * - A single kebab button (top-right) opening the same portal menu pattern ReelTile
 *   uses: full labels, flip-aware desktop popover, bottom action sheet on coarse
 *   pointers. Replaces the old vertical icon stack that clipped the ~120px tile.
 * - Tile tap stays the primary action: open (annotate) live games, Extend/Recap
 *   expired ones.
 *
 * Every game action (open, watch recap, share, edit, extend, delete) stays
 * reachable via the tile tap + kebab menu.
 */
export function GameTile({
  game,
  onLoad,
  onDelete,
  onExtend,
  onPlayRecap,
  onShare,
  onEdit,
  onRetryUpload,   // T7490: re-select the original file + resume the multipart upload
  onDiscardFailed, // T7490: full cascade delete (the ONE case cascade is correct)
}) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  // T7490: an upload that never finished (R2 multipart reaped). No video, no poster;
  // the game row survives only because the user may have annotated clips against it
  // during transfer (T1540). Distinct fail-state skin + a persistent Retry/Discard bar.
  const isUploadFailed = game.status === 'upload_failed';
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [posterState, setPosterState] = useState('loading'); // 'loading' | 'loaded' | 'error'
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState(null); // {top, left} for the desktop portal
  const menuRef = useRef(null);
  const kebabBtnRef = useRef(null);
  const isMobile = useIsMobile();

  // Current profile's sport drives the no-poster fallback glyph (item 1). Same
  // store access ProfileSportButton uses; unknown/custom sport -> app logo.
  const profiles = useProfileStore((state) => state.profiles);
  const currentProfileId = useProfileStore((state) => state.currentProfileId);
  const currentProfile = profiles.find((p) => p.id === currentProfileId);
  const sportGlyph = sportEmojiOrNull(currentProfile?.sport);

  const isExpired = game.storage_status === 'expired';
  const hasRecap = Boolean(game.recap_video_url);

  // T8260: secondary-line counts. "annotations" = the existing clip_count (raw_clips
  // rows saved while annotating), relabeled here only. "reels" = reel_count, the
  // published reels attributable to this game (see games.py _compute_reel_counts).
  // Built in ONE place so T8130's Play/Highlight-Reel rename can update it in a
  // single edit. The reels segment is omitted entirely when there are none.
  const annotationsLabel = `${game.clip_count} annotation${game.clip_count !== 1 ? 's' : ''}`;
  const reelCount = game.reel_count || 0;
  const countsLabel = reelCount > 0
    ? `${annotationsLabel} • ${reelCount} reel${reelCount !== 1 ? 's' : ''}`
    : annotationsLabel;
  const canExtend = game.can_extend !== false;
  const daysLeft = getDaysUntil(game.storage_expires_at);
  const isNearExpiry = !isExpired && daysLeft !== null && daysLeft < 14;

  // Desktop popover positioning: anchor to the kebab rect, flip up near the
  // viewport bottom, right-align the w-44 menu (mirrors ReelTile).
  useEffect(() => {
    if (!menuOpen || isMobile || !kebabBtnRef.current) {
      if (!menuOpen) setMenuPos(null);
      return;
    }
    const updatePosition = () => {
      const rect = kebabBtnRef.current.getBoundingClientRect();
      const menuHeight = 260; // approximate; enough to decide the flip
      const flipped = rect.bottom + menuHeight > window.innerHeight;
      setMenuPos({
        top: flipped ? rect.top - menuHeight : rect.bottom + 4,
        left: rect.right - 176, // w-44 = 176px, right-aligned
      });
    };
    updatePosition();
    const onResize = () => updatePosition();
    window.addEventListener('resize', onResize);
    const onOutside = (e) => {
      if (
        menuRef.current && !menuRef.current.contains(e.target) &&
        kebabBtnRef.current && !kebabBtnRef.current.contains(e.target)
      ) {
        setMenuOpen(false);
        setShowDeleteConfirm(false);
      }
    };
    document.addEventListener('mousedown', onOutside);
    document.addEventListener('touchstart', onOutside);
    return () => {
      window.removeEventListener('resize', onResize);
      document.removeEventListener('mousedown', onOutside);
      document.removeEventListener('touchstart', onOutside);
    };
  }, [menuOpen, isMobile]);

  const closeMenu = () => {
    setMenuOpen(false);
    setShowDeleteConfirm(false);
  };

  const handleDelete = (e) => {
    e.stopPropagation();
    if (showDeleteConfirm) {
      closeMenu();
      onDelete?.();
    } else {
      setShowDeleteConfirm(true);
    }
  };

  const runAction = (e, fn) => {
    e.stopPropagation();
    closeMenu();
    fn?.();
  };

  // Primary tile action: load (annotate) a live game; Extend/Recap an expired one.
  const activatePrimary = () => {
    // T7490: a failed upload has no video to open — its only actions live in the
    // bottom Retry/Discard bar. The tile itself is inert.
    if (isUploadFailed) return;
    if (isExpired) {
      if (canExtend) onExtend?.();
      else if (hasRecap) onPlayRecap?.();
    } else {
      onLoad();
    }
  };

  const handleClick = (e) => {
    // A tap inside the kebab, its menu, or the edit pencil must not trigger the
    // primary open (T6890 added the pencil as a sibling of the name in the scrim).
    if (e.target.closest('[data-game-kebab]') || e.target.closest('[data-game-menu]') || e.target.closest('[data-game-edit]')) return;
    activatePrimary();
  };

  // Keyboard activation (item 3): Enter/Space opens the tile's primary action.
  const handleKeyDown = (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if (e.target.closest('[data-game-kebab]') || e.target.closest('[data-game-menu]') || e.target.closest('[data-game-edit]')) return;
    e.preventDefault();
    activatePrimary();
  };

  // Must carry API_BASE: on staging/prod the frontend (CF Pages) and API (Fly) are
  // different hosts, so a bare `/api/...` src resolves against the Pages origin and
  // returns the SPA shell (200 text/html) instead of the image -> the <img> errors
  // into the branded fallback and every poster silently breaks (T5890). Locally the
  // Vite proxy masks it. Mirrors DraftTile/DownloadsPanel/CollectionHeader poster URLs.
  // T7940: append the owner's profile_id so a URL-keyed cache (CDN/proxy/browser)
  // can never serve one account's poster bytes for another account's same-numbered
  // game. game.id is a per-profile AUTOINCREMENT (not globally unique), so the bare
  // path collides across accounts; the query param disambiguates. Backend rejects a
  // mismatched profile_id with 403 (cache-correctness token, not the auth check).
  const posterUrl = `${API_BASE}/api/games/${game.id}/poster.jpg?profile_id=${currentProfileId}`;

  // Action descriptors -- rendered once for the desktop popover and once for the
  // mobile sheet (Delete is separate: it carries the two-tap confirm).
  const actions = [
    hasRecap && { key: 'play', label: 'Watch recap', icon: Play, onClick: onPlayRecap },
    !isExpired && { key: 'share', label: 'Share game', icon: Share2, onClick: onShare },
    // T6890: Edit game moved to the pencil beside the name in the scrim (below).
    canExtend && (isExpired || isNearExpiry) &&
      { key: 'extend', label: 'Extend storage', icon: RefreshCw, onClick: onExtend },
  ].filter(Boolean);

  const menuItemClass =
    'w-full flex items-center gap-3 px-4 py-3 text-sm text-left text-gray-200 hover:bg-gray-600 transition-colors';

  const menuItems = (iconSize) => (
    <>
      {actions.map(({ key, label, icon: Icon, onClick }) => (
        <button key={key} type="button" onClick={(e) => runAction(e, onClick)} className={menuItemClass}>
          <Icon size={iconSize} className="text-gray-300 flex-shrink-0" />
          <span>{label}</span>
        </button>
      ))}
      <div className="my-1 border-t border-gray-600" />
      <button
        type="button"
        onClick={handleDelete}
        className={`w-full flex items-center gap-3 px-4 py-3 text-sm text-left transition-colors ${
          showDeleteConfirm ? 'bg-red-900/40 text-red-300' : 'text-red-400 hover:bg-red-900/40'
        }`}
      >
        <Trash2 size={iconSize} className="flex-shrink-0" />
        <span>{showDeleteConfirm ? 'Tap again to confirm' : 'Delete game'}</span>
      </button>
    </>
  );

  return (
    <div
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      aria-label={isUploadFailed ? `${game.name} — upload incomplete` : undefined}
      className={`relative group aspect-video bg-gray-800 rounded-lg overflow-hidden border transition-all duration-150 outline-none
        focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900 focus-visible:z-10 ${
        isUploadFailed
          ? 'border-rose-800/60 ring-1 ring-inset ring-rose-900/40 cursor-default focus-visible:ring-rose-400'
          : isExpired
            ? 'cursor-pointer hover:scale-[1.03] hover:z-10 hover:brightness-105 hover:shadow-lg hover:shadow-cyan-900/40 border-yellow-800/40 hover:border-yellow-600 focus-visible:ring-cyan-400'
            : 'cursor-pointer hover:scale-[1.03] hover:z-10 hover:brightness-105 hover:shadow-lg hover:shadow-cyan-900/40 border-gray-700 hover:border-cyan-400 hover:ring-2 hover:ring-cyan-400/60 focus-visible:ring-cyan-400'
      }`}
    >
      {/* Poster image or fallback (item 5 — shimmer while loading, fade in on load) */}
      {posterState === 'loading' && (
        <div className="absolute inset-0 skeleton-shimmer" />
      )}
      {posterState !== 'error' && (
        <img
          src={posterUrl}
          alt={game.name}
          className={`w-full h-full object-cover transition-opacity duration-500 ${isExpired ? 'grayscale' : ''} ${
            posterState !== 'loaded' ? 'opacity-0' : isExpired ? 'opacity-60' : 'opacity-100'
          }`}
          onLoad={() => setPosterState('loaded')}
          onError={() => setPosterState('error')}
        />
      )}

      {/* Branded fallback (no poster): current sport ball, else the app logo. */}
      {posterState === 'error' && (
        <div className="absolute inset-0 bg-gradient-to-br from-gray-800 to-gray-900 flex flex-col items-center justify-center">
          <div className="text-center px-4">
            {sportGlyph ? (
              <div className="text-2xl mb-2" aria-hidden>{sportGlyph}</div>
            ) : (
              <div className="mb-2 flex justify-center" aria-hidden>
                <Logo size={28} />
              </div>
            )}
            <p className="text-xs text-gray-400">ReelBallers</p>
            <p className="text-[10px] text-gray-500 mt-1">No poster</p>
          </div>
        </div>
      )}

      {/* T7490: rose scrim dims the dead poster/fallback so the fail-state badge and
          action bar dominate. Above the poster (z-[5]) but below the bottom name
          scrim (z-10), chip (z-20) and action bar (z-30). */}
      {isUploadFailed && (
        <div className="absolute inset-0 z-[5] bg-gradient-to-b from-rose-950/50 via-black/45 to-black/80" aria-hidden />
      )}

      {/* Bottom scrim: game name (primary line) + date and annotation/reel counts
          (secondary line; T8260 relabeled "clips" -> "annotations" and added reels).
          One structure for BOTH the poster and the fallback -- this div is always
          rendered (not gated on posterState), so it overlays whichever variant is
          showing beneath it. Name is a single truncated line (tiles run as small
          as ~90px tall at the 2-up 390px breakpoint, so no 2-line clamp here). The
          gradient is opaque enough at the base to stay legible over a bright
          poster frame. */}
      <div className={`absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/95 via-black/55 to-transparent px-2 pt-6 ${isUploadFailed ? 'pb-9' : 'pb-1.5'}`}>
        {/* T6890: the edit (rename) pencil sits beside the game name it edits,
            instead of only inside the top-right kebab. Same "icon touches the name"
            placement as DraftTile/ReelTile (ManageProfilesModal reference pattern:
            a pencil button next to the name that opens the edit form).
            T7490: hidden for a failed upload — you can't meaningfully rename a dead
            upload, and its hit target would compete with the action bar. */}
        <div className="flex items-center gap-1">
          <h3 className="flex-1 min-w-0 text-white text-xs sm:text-sm font-medium truncate drop-shadow" title={game.name}>
            {game.name}
          </h3>
          {!isUploadFailed && (
            <button
              type="button"
              data-game-edit
              onClick={(e) => { e.stopPropagation(); onEdit?.(); }}
              title="Edit game"
              aria-label="Edit game"
              className="flex-shrink-0 inline-flex items-center justify-center rounded text-gray-300 hover:text-white transition-colors min-h-[32px] min-w-[32px]"
            >
              <Pencil size={14} />
            </button>
          )}
        </div>
        {/* T7330: the MATCH date, with its weekday ("Sat, Mar 21"). T7290 removed the date
            entirely on the reasoning that it was already the title suffix -- wrong in
            practice: the name above is `truncate`d in ~120px (it shares its row with the
            pencil), so the suffix is structurally the FIRST thing clipped, and a game with
            no opponent recorded gets no suffix at all. The weekday earns the second copy
            its place (youth sport is weekend-shaped) and keeps it from reading as an echo.
            Empty when there is no match date -- NEVER the upload date, which would
            contradict the match-date header this tile sits under. */}
        {isUploadFailed ? (
          <p className="mt-0.5 text-[11px] text-rose-200/90 leading-snug">
            {game.clip_count > 0
              ? `Upload didn't finish. ${game.clip_count} annotation${game.clip_count !== 1 ? 's' : ''} saved — Retry to keep them.`
              : "Upload didn't finish. Retry to resume, or discard."}
          </p>
        ) : (
          <div className="mt-0.5 flex flex-col sm:flex-row sm:items-center sm:justify-between sm:gap-2 text-xs">
            <span className="text-gray-300 truncate">{formatMatchDateLabel(game.game_date)}</span>
            <span className="flex-shrink-0 whitespace-nowrap text-gray-400">{countsLabel}</span>
          </div>
        )}
      </div>

      {/* Top-left chip. T7490: a failed upload shows a rose "Upload incomplete" badge
          (error) and suppresses the yellow expiry chip (an unfinished upload can't
          meaningfully be "expiring") — a deliberately different hue family so the two
          states are never confused at a glance.
          T7820: UploadingGameTile.jsx MIRRORS this failed skin for client-side errored
          uploads (it can't reuse this component: no game row/poster endpoint exists
          yet). If you change this skin, change the mirror too. */}
      {isUploadFailed ? (
        <div className="absolute top-1.5 left-1.5 z-20 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-900/80 text-rose-200 ring-1 ring-rose-500/40">
          <AlertTriangle size={10} />
          Upload incomplete
        </div>
      ) : (isExpired || isNearExpiry) && (
        <div className="absolute top-1.5 left-1.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-yellow-900/70 text-yellow-300 z-20">
          <Clock size={10} />
          {isExpired ? 'Expired' : `${daysLeft}d`}
        </div>
      )}

      {/* T7490: a failed upload replaces the kebab (its Recap/Share/Extend/Delete are
          all nonsensical or replaced here) with the persistent Retry/Discard bar below. */}
      {isUploadFailed && (
        <div
          className="absolute inset-x-0 bottom-0 z-30 flex items-stretch gap-1 p-1.5"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Retry — primary. Cyan carries its app-wide "the action that saves your
              work" meaning here; RefreshCw reads "resume", not "fresh upload". */}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setShowDiscardConfirm(false); onRetryUpload?.(); }}
            className="flex-1 inline-flex items-center justify-center gap-1.5 min-h-[36px] px-2 rounded-md
                       bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold
                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 transition-colors"
            aria-label={`Retry upload of ${game.name}`}
          >
            <RefreshCw size={14} className="flex-shrink-0" />
            Retry
          </button>

          {/* Discard — destructive, two-tap confirm. Escalates (compact rose chip ->
              solid red) before firing the full cascade delete. */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (showDiscardConfirm) { onDiscardFailed?.(); }
              else { setShowDiscardConfirm(true); }
            }}
            className={`inline-flex items-center justify-center gap-1.5 min-h-[36px] px-2 rounded-md text-xs font-semibold
                        focus-visible:outline-none focus-visible:ring-2 transition-colors ${
              showDiscardConfirm
                ? 'flex-[1.6] bg-red-600 hover:bg-red-500 text-white focus-visible:ring-red-300'
                : 'flex-none bg-black/60 hover:bg-red-900/50 text-rose-300 ring-1 ring-rose-800/60 focus-visible:ring-red-400'
            }`}
            aria-label={showDiscardConfirm
              ? `Confirm discard of ${game.name} — this permanently deletes it and its clips`
              : `Discard ${game.name}`}
          >
            <Trash2 size={14} className="flex-shrink-0" />
            {showDiscardConfirm ? 'Delete for good?' : 'Discard'}
          </button>
        </div>
      )}

      {/* Single kebab button (top-right) -- opens the portal menu / bottom sheet.
          Always visible on coarse pointers (no hover); reveals on hover for
          desktop. One button never overflows the tile. Suppressed for a failed
          upload (T7490). */}
      {!isUploadFailed && (
      <button
        ref={kebabBtnRef}
        type="button"
        data-game-kebab
        onClick={(e) => { e.stopPropagation(); setMenuOpen((o) => !o); setShowDeleteConfirm(false); }}
        title="More actions"
        aria-label="More actions"
        className={`absolute top-1.5 right-1.5 z-30 inline-flex items-center justify-center min-h-[32px] min-w-[32px] rounded-full bg-black/60 backdrop-blur-sm text-white hover:bg-black/80 transition-opacity ${
          isMobile ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus:opacity-100'
        } ${menuOpen ? 'opacity-100' : ''}`}
      >
        <MoreVertical size={16} />
      </button>
      )}

      {/* Mobile: bottom action sheet. Desktop: fixed-position flip-aware popover. */}
      {!isUploadFailed && menuOpen && isMobile ? (
        <div data-game-menu ref={menuRef} className="fixed inset-0 z-50 flex flex-col" onClick={(e) => e.stopPropagation()}>
          <div className="flex-1 bg-black/40" onClick={closeMenu} />
          <div className="bg-gray-800 rounded-t-2xl border-t border-gray-700 max-h-[70vh] overflow-y-auto">
            <div className="flex items-center justify-center pt-2 pb-1">
              <div className="h-1 w-10 bg-gray-600 rounded-full" />
            </div>
            <div className="py-2">{menuItems(20)}</div>
          </div>
        </div>
      ) : !isUploadFailed && menuOpen && menuPos ? (
        createPortal(
          <div
            data-game-menu
            ref={menuRef}
            className="fixed bg-gray-700 border border-gray-600 rounded-lg shadow-xl z-50 w-44 py-1"
            style={{ top: `${menuPos.top}px`, left: `${Math.max(8, menuPos.left)}px` }}
            onClick={(e) => e.stopPropagation()}
          >
            {menuItems(18)}
          </div>,
          document.body
        )
      ) : null}
    </div>
  );
}
