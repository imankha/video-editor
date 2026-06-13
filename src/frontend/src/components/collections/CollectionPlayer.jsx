import React, { useRef, useEffect, useCallback } from 'react';
import { X } from 'lucide-react';
import { Button } from '../shared/Button';
import { RATIO } from '../../constants/aspectRatios';
import { useStoryPlayback } from './useStoryPlayback';

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
 */
export function CollectionPlayer({
  reels,
  initialIndex = 0,
  title,
  onClose,
  onReelChange,
  onEnded,
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

      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <h3 className="text-white text-sm font-medium truncate min-w-0">{title}</h3>
        <Button variant="ghost" size="sm" icon={X} iconOnly onClick={onClose} />
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
