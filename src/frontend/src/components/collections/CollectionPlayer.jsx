import React, { useRef, useEffect, useCallback } from 'react';
import { X, Download, Loader, Pencil, Scale } from 'lucide-react';
import { Button } from '../shared/Button';
import { RATIO } from '../../constants/aspectRatios';
import { useStoryPlayback } from './useStoryPlayback';
import { formatGameClock } from '../../utils/timeFormat';

const SWIPE_THRESHOLD_PX = 48;

/**
 * CollectionPlayer - Sequential "story" player for a collection's reels (T3610).
 *
 * STRICTLY presentational: no stores, no fetching. URLs + metadata arrive via
 * props (T3620's public viewer feeds presigned URLs instead of the stream proxy).
 *
 * Closes ONLY via the X button — no backdrop close (project rule: misclicks must
 * not dismiss). All reels passed in share one ratio (the container scopes by
 * ratio), so the layout branches once on the active reel's aspect_ratio.
 *
 * @param {Array}    reels          - ordered [{ id, name, streamUrl, aspect_ratio, duration|null }]
 * @param {number=}  initialIndex   - default 0
 * @param {string}   title          - group name shown in the chrome
 * @param {Function} onClose        - REQUIRED. X button only.
 * @param {Function=} onReelChange  - (index, reel) — T3620 hooks watched/analytics
 * @param {Function=} onEnded       - all reels finished
 * @param {Function=} onDownload    - (activeReel) => void; shows a Download button when set
 * @param {boolean=}  downloadLoading
 * @param {Function=} onReEdit      - (activeReel) => void; shows a "Re-edit" button when set
 *                                     AND the active reel has an editable project (T3940). The
 *                                     public viewer omits this prop, so its player has no button.
 * @param {number|null=} reEditLoadingId - download id currently restoring; spins the button for it
 * @param {Function=} onReRank      - (activeReel) => void; shows a "Re-rank this" button when set
 *                                     AND the active reel is a single-clip reel with an editable
 *                                     project (T4030). Author-only: the public viewer omits this
 *                                     prop, so its player never shows it. Hidden on Mixes/multi-clip.
 * @param {number|null=} reRankLoadingId - download id currently re-ranking; spins the button for it
 */
export function CollectionPlayer({
  reels,
  initialIndex = 0,
  title,
  onClose,
  onReelChange,
  onEnded,
  onDownload,
  downloadLoading,
  onReEdit,
  reEditLoadingId,
  onReRank,
  reRankLoadingId,
}) {
  const videoRef = useRef(null);
  const pointerStart = useRef(null);

  const handleAllEnded = useCallback(() => onEnded?.(), [onEnded]);
  const handleReelChange = useCallback(
    (index, reel) => onReelChange?.(index, reel),
    [onReelChange],
  );

  const {
    activeIndex,
    activeReel,
    segmentProgress,
    next,
    prev,
    togglePlay,
  } = useStoryPlayback(videoRef, reels, {
    initialIndex,
    onAllEnded: handleAllEnded,
    onReelChange: handleReelChange,
  });

  // Keyboard: arrows navigate, space toggles, escape closes.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); next(); }
      else if (e.key === ' ') { e.preventDefault(); togglePlay(); }
      else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next, prev, togglePlay, onClose]);

  const onPointerDown = (e) => {
    pointerStart.current = { x: e.clientX, t: Date.now() };
  };

  const onPointerUp = (e) => {
    const start = pointerStart.current;
    pointerStart.current = null;
    if (!start) return;
    const dx = e.clientX - start.x;
    if (Math.abs(dx) > SWIPE_THRESHOLD_PX) {
      if (dx > 0) prev(); else next();
      return;
    }
    // Tap zones: left third prev, right third next, center toggle.
    const rect = e.currentTarget.getBoundingClientRect();
    const rel = (e.clientX - rect.left) / rect.width;
    if (rel < 1 / 3) prev();
    else if (rel > 2 / 3) next();
    else togglePlay();
  };

  if (!activeReel) return null;

  const isPortrait = activeReel.aspect_ratio === RATIO.PORTRAIT;

  return (
    <div className="fixed inset-0 z-[70] bg-black flex flex-col select-none md:inset-12 md:rounded-xl md:overflow-hidden">
      {/* Segmented progress bar */}
      <div className="flex gap-1 px-3 pt-3">
        {reels.map((_, i) => (
          <div key={i} className="h-1 flex-1 rounded-full bg-white/25 overflow-hidden">
            <div
              className="h-full bg-white rounded-full"
              style={{
                width: i < activeIndex ? '100%'
                  : i === activeIndex ? `${segmentProgress * 100}%`
                  : '0%',
              }}
            />
          </div>
        ))}
      </div>

      {/* Header: source game + in-match minute for the active reel (T3920),
          falling back to the group title for multi-clip reels with no game. */}
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <h3 className="text-white text-sm font-medium truncate min-w-0">
          {activeReel.gameName ? (
            <>
              {activeReel.gameName}
              {formatGameClock(activeReel.gameStartTime) && (
                <span className="ml-2 font-mono text-gray-300">
                  {formatGameClock(activeReel.gameStartTime)}
                </span>
              )}
            </>
          ) : title}
        </h3>
        <div className="flex items-center gap-2 shrink-0">
          {/* T3940: jump straight into THIS reel's editor (acts on the active reel).
              Gated on the prop (public viewer omits it) AND an editable project
              (project_id null/0 -> non-editable export, button hidden). */}
          {onReEdit && activeReel.project_id ? (
            <Button
              variant="ghost"
              size="sm"
              icon={reEditLoadingId === activeReel.id ? Loader : Pencil}
              iconOnly
              disabled={reEditLoadingId === activeReel.id}
              title="Re-edit this reel"
              onClick={() => onReEdit(activeReel)}
              className={reEditLoadingId === activeReel.id ? '[&_svg]:animate-spin' : ''}
            />
          ) : null}
          {/* T4030: re-open THIS reel for ranking (rd reset, progress drops).
              Author-only (public viewer omits onReRank) AND single-clip with an
              editable project -- Mixes/multi-clip never rank, so the control hides. */}
          {onReRank && activeReel.project_id && activeReel.clip_count === 1 ? (
            <Button
              variant="ghost"
              size="sm"
              icon={reRankLoadingId === activeReel.id ? Loader : Scale}
              iconOnly
              disabled={reRankLoadingId === activeReel.id}
              title="Re-rank this reel"
              onClick={() => onReRank(activeReel)}
              className={reRankLoadingId === activeReel.id ? '[&_svg]:animate-spin' : ''}
            />
          ) : null}
          {onDownload && (
            <Button
              variant="primary"
              size="sm"
              icon={downloadLoading ? Loader : Download}
              disabled={downloadLoading}
              onClick={() => onDownload(activeReel)}
              className={downloadLoading ? '[&_svg]:animate-spin' : ''}
            >
              {downloadLoading ? 'Downloading...' : 'Download'}
            </Button>
          )}
          <Button variant="ghost" size="sm" icon={X} iconOnly onClick={onClose} />
        </div>
      </div>

      {/* Video + tap/swipe zones */}
      <div
        className="relative flex-1 min-h-0 flex items-center justify-center"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
      >
        <video
          ref={videoRef}
          src={activeReel.streamUrl}
          playsInline
          autoPlay
          className={`max-h-full max-w-full object-contain ${isPortrait ? 'h-full' : 'w-full'}`}
        />

        {/* Per-reel title overlay, fades in on reel change */}
        {activeReel.name && (
          <div
            key={activeIndex}
            className="absolute bottom-4 left-4 right-4 text-center pointer-events-none collection-player-title"
          >
            <span className="inline-block max-w-full truncate rounded-full bg-black/60 px-3 py-1 text-sm text-white">
              {activeReel.name}
            </span>
          </div>
        )}
      </div>

      <style>{`
        @keyframes collectionPlayerTitleFade {
          0% { opacity: 0; }
          15% { opacity: 1; }
          70% { opacity: 1; }
          100% { opacity: 0; }
        }
        .collection-player-title {
          animation: collectionPlayerTitleFade 2.4s ease-out forwards;
        }
      `}</style>
    </div>
  );
}

export default CollectionPlayer;
