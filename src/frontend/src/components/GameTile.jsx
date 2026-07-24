import React, { useState, useRef } from 'react';
import { Play, Share2, Pencil, RefreshCw, Trash2, Loader2, Clock } from 'lucide-react';
import { Button } from './shared/Button';
import { useIsMobile } from '../hooks/useIsMobile';
import { GAME } from '../config/themeColors';
import { getDaysUntil, ExpirationBadge } from './ExpirationBadge';

/**
 * GameTile - Landscape (16:9) poster tile for games in the games tab grid (T5681).
 *
 * Presents a game as a landscape tile with:
 * - Poster image (recap poster) or branded fallback
 * - Minimal overlay: date + clip count
 * - Expiry chip (if near/expired)
 * - Actions: play recap, share, edit, extend, delete
 * - Desktop: hover shows actions; Mobile: long-press shows action menu
 * - Expired variant: grayscale, primary action is Extend/Recap
 *
 * All GameCard actions remain reachable per the reachability matrix.
 */
export function GameTile({
  game,
  onLoad,
  onDelete,
  onExtend,
  onPlayRecap,
  onShare,
  onEdit,
}) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [actionsRevealed, setActionsRevealed] = useState(false);
  const [posterState, setPosterState] = useState('loading'); // 'loading' | 'loaded' | 'error'
  const longPressTimer = useRef(null);
  const touchMoved = useRef(false);
  const longPressFired = useRef(false);
  const isMobile = useIsMobile();

  const isExpired = game.storage_status === 'expired';
  const hasRecap = Boolean(game.recap_video_url);
  const canExtend = game.can_extend !== false;
  const daysLeft = getDaysUntil(game.storage_expires_at);
  const isNearExpiry = !isExpired && daysLeft !== null && daysLeft < 14;

  const handleDelete = (e) => {
    e.stopPropagation();
    if (showDeleteConfirm) {
      onDelete();
    } else {
      setShowDeleteConfirm(true);
      setTimeout(() => setShowDeleteConfirm(false), 3000);
    }
  };

  const handleClick = (e) => {
    if (isMobile) {
      if (longPressFired.current) return;
      if (actionsRevealed) {
        const isButton = e.target.closest('button');
        if (isButton) return;
        setActionsRevealed(false);
        setShowDeleteConfirm(false);
        return;
      }
    }
    // Primary action: load (annotate) unless expired
    if (isExpired) {
      if (canExtend) {
        onExtend?.();
      } else if (hasRecap) {
        onPlayRecap?.();
      }
    } else {
      onLoad();
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

  const posterUrl = `/api/games/${game.id}/poster.jpg`;

  return (
    <div
      onClick={handleClick}
      onTouchStart={isMobile ? handleTouchStart : undefined}
      onTouchMove={isMobile ? handleTouchMove : undefined}
      onTouchEnd={isMobile ? handleTouchEnd : undefined}
      className={`relative group aspect-video bg-gray-800 rounded-lg overflow-hidden border transition-all cursor-pointer ${
        isExpired
          ? 'border-yellow-800/40 hover:border-yellow-700/50'
          : 'border-gray-700 hover:border-gray-600'
      }`}
    >
      {/* Poster image or fallback */}
      {posterState === 'loading' && (
        <div className="absolute inset-0 bg-gray-700 animate-pulse" />
      )}
      {posterState !== 'error' && (
        <img
          src={posterUrl}
          alt={game.name}
          className={`w-full h-full object-cover ${isExpired ? 'grayscale opacity-60' : ''}`}
          onLoad={() => setPosterState('loaded')}
          onError={() => setPosterState('error')}
        />
      )}

      {/* Branded fallback (no poster) */}
      {posterState === 'error' && (
        <div className="absolute inset-0 bg-gradient-to-br from-gray-800 to-gray-900 flex flex-col items-center justify-center">
          <div className="text-center px-4">
            <div className={`text-2xl font-bold mb-2 ${GAME.accent}`}>⚾</div>
            <p className="text-xs text-gray-400">Reel Ballers</p>
            <p className="text-[10px] text-gray-500 mt-1">No poster</p>
          </div>
        </div>
      )}

      {/* Minimal overlay: date + clip count (always visible) */}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent px-2 py-2">
        <div className="flex items-center justify-between gap-1 text-xs">
          <span className="text-gray-300">
            {new Date(game.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}
          </span>
          <span className="text-gray-400">
            {game.clip_count} clip{game.clip_count !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {/* Expiry chip (if near expiry or expired) */}
      {isExpired && (
        <div className="absolute top-1.5 right-1.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-yellow-900/70 text-yellow-300 z-20">
          <Clock size={10} />
          Expired
        </div>
      )}
      {isNearExpiry && !isExpired && (
        <div className="absolute top-1.5 right-1.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-yellow-900/70 text-yellow-300 z-20">
          <Clock size={10} />
          {daysLeft}d
        </div>
      )}

      {/* Action buttons: desktop reveals on hover (opacity-0 -> group-hover:opacity-100);
          mobile stays hidden until a long-press sets actionsRevealed (matches GameCard's
          `(!isMobile || actionsRevealed)` gate -- the tile must NOT render this cluster
          on mobile until the gesture fires, or every tile shows its actions at once). */}
      {(!isMobile || actionsRevealed) && (
      <div className={`absolute top-2 right-2 flex flex-col gap-1 transition-opacity z-30 ${
        isMobile ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
      }`}>
        {hasRecap && (
          <Button
            variant="secondary"
            size="sm"
            icon={Play}
            iconOnly
            onClick={(e) => { e.stopPropagation(); onPlayRecap?.(); }}
            title="Watch recap"
          />
        )}
        {!isExpired && (
          <Button
            variant="secondary"
            size="sm"
            icon={Share2}
            iconOnly
            onClick={(e) => { e.stopPropagation(); onShare?.(); }}
            title="Share game"
          />
        )}
        <Button
          variant="secondary"
          size="sm"
          icon={Pencil}
          iconOnly
          onClick={(e) => { e.stopPropagation(); onEdit?.(); }}
          title="Edit game"
        />
        {isExpired && canExtend && (
          <Button
            variant="secondary"
            size="sm"
            icon={RefreshCw}
            iconOnly
            onClick={(e) => { e.stopPropagation(); onExtend?.(); }}
            title="Extend storage"
          />
        )}
        {!isExpired && isNearExpiry && canExtend && (
          <Button
            variant="secondary"
            size="sm"
            icon={RefreshCw}
            iconOnly
            onClick={(e) => { e.stopPropagation(); onExtend?.(); }}
            title="Extend storage"
          />
        )}
        <Button
          variant={showDeleteConfirm ? 'danger' : 'secondary'}
          size="sm"
          icon={Trash2}
          iconOnly
          onClick={handleDelete}
          title={showDeleteConfirm ? 'Click again to confirm' : 'Delete game'}
        />
      </div>
      )}
    </div>
  );
}
