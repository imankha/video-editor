import { useEffect, useRef, useState } from 'react';
import { Film, Clock } from 'lucide-react';
import { PULSE_CLASS } from './hooks/usePulseHighlight';
import { ANNOTATE } from '../../config/displayNames';

/**
 * VideoLane (T13280) - the desktop timeline's map of a multi-video game: one block per
 * main-footage video directly below the scrubber, tapping a block picks that video
 * (the same `onPick` as the SourceBar under the player, so both surfaces behave as one
 * control). Angles keep their own violet rows (AngleLanes) below this lane.
 *
 * Blocks are positioned on the time axis but never shrink below MIN_BLOCK_PX, and a
 * block that would overlap the previous one is pushed right. So a 19 second video next
 * to an 85 minute one is still a readable, tappable block instead of a 4px sliver; the
 * boundary flag on the Video track above keeps the TRUE position honest.
 *
 * Not mounted on phones (AnnotateTimeline gates on !isMobile): the lane would scroll
 * with the 3x track there, and the SourceBar already lists every video.
 */

// Minimum rendered width of a block, px. Enough for the icon plus a few characters.
export const MIN_BLOCK_PX = 56;
const GAP_PX = 2;

export default function VideoLane({
  videos = [],
  activeSequence = null,
  duration,
  onPick,
  edgePadding = 20,
  pulseSequence = null,
}) {
  // The inner strip (inside the edge padding) is the usable axis; its width drives the
  // px layout the collision pass needs.
  const innerRef = useRef(null);
  const [innerWidth, setInnerWidth] = useState(0);

  useEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setInnerWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (!duration || videos.length === 0) return null;

  let cursor = 0;
  const blocks = videos.map((v) => {
    const trueLeft = innerWidth * (v.virtualStart / duration);
    const left = Math.max(trueLeft, cursor);
    const naturalWidth = innerWidth * ((v.virtualEnd - v.virtualStart) / duration);
    const roomRight = Math.max(MIN_BLOCK_PX, innerWidth - left);
    const width = Math.min(Math.max(naturalWidth, MIN_BLOCK_PX), roomRight);
    cursor = left + width + GAP_PX;
    return { ...v, left, width };
  });

  return (
    <div className="mt-1" data-testid="video-lane">
      <div
        className="relative h-6 bg-gray-800 rounded"
        style={{ paddingLeft: `${edgePadding}px`, paddingRight: `${edgePadding}px` }}
      >
        <div ref={innerRef} className="relative h-full">
          {blocks.map((b) => {
            const isActive = b.sequence === activeSequence;
            return (
              <button
                key={b.sequence}
                type="button"
                data-testid={`video-block-${b.sequence}`}
                aria-pressed={isActive}
                title={b.placedAtEnd ? ANNOTATE.appendedFootageTitle(b.name) : ANNOTATE.jumpToVideoTitle(b.name)}
                onClick={(e) => { e.stopPropagation(); onPick?.(b.sequence); }}
                className={`absolute top-0 bottom-0 flex items-center gap-1 rounded px-1.5 overflow-hidden text-[11px] font-medium leading-none transition-colors ${
                  isActive
                    ? 'bg-blue-600 text-white ring-1 ring-inset ring-blue-300'
                    : 'bg-gray-700 border border-blue-500/30 text-blue-100 hover:bg-gray-600'
                } ${b.sequence === pulseSequence ? PULSE_CLASS : ''}`}
                style={{ left: `${b.left}px`, width: `${b.width}px` }}
              >
                {b.placedAtEnd
                  ? <Clock size={11} className="shrink-0 text-amber-300" />
                  : <Film size={11} className="shrink-0" />}
                <span className="truncate">{b.name}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
