import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Film, Video, Clock, ArrowLeftRight, ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react';
import { PULSE_CLASS } from './hooks/usePulseHighlight';
import { ANNOTATE } from '../../config/displayNames';

/**
 * SourceBar (T13280) - the Videos control for a game with 2+ videos. One row directly
 * under the player controls, present on every width whenever the game has more than
 * one video, so the active source is always named next to the picture and every video
 * is reachable regardless of its share of the timeline (a 19s video gets the same tap
 * target as an 85 minute one; the proportional chips it replaces could not do that).
 *
 *  - 2-3 videos: a compact trigger AT REST ("Video n of m", tap to expand), so the bar
 *    stays out of the way when nothing is happening right now. It EXPANDS into one
 *    segment per video -- the one playing filled (blue = main footage, violet = an
 *    angle, the T8890 meanings), a non-active segment covering the playhead carrying
 *    the swap glyph (tap switches cameras in place), any other segment jumping to that
 *    video's start -- automatically whenever a genuine conflict exists at the playhead
 *    (another source covers this exact moment), or manually via the trigger. Every
 *    video stays reachable at all times either way: collapsing never removes a video
 *    from the switcher, it only hides the always-visible picker when there is nothing
 *    to switch to right here (T13280 follow-up, user 2026-10-22: "only show this when
 *    the playhead is on a frame with overlapping videos").
 *  - 4+ videos: always a trigger showing the active video, prev/next, and a portalled
 *    list with the same rows plus the Fix timing rows for angles (segments would be
 *    unreadable at that count; collapsing has no additional benefit to add there).
 *
 * Feedback contract: the container answers EVERY tap (including one on the already
 * active video) with `notice` ("Now watching {name}", ~1.5s) and a pulse on the tapped
 * segment, so no tap is silent. The same notice slot shows "Back to main camera" on
 * auto-fallback. Nothing here writes: picks are seeks or camera switches.
 */

// Up to this many videos every one is a segment; beyond it the row becomes a trigger
// with prev/next and a list (segments would be unreadable on a phone).
export const MAX_SEGMENTS = 3;

function segmentClasses(kind, isActive) {
  if (kind === 'angle') {
    return isActive
      ? 'bg-violet-600 text-white ring-1 ring-inset ring-violet-300'
      : 'bg-gray-700 border border-violet-500/40 text-violet-200 hover:bg-gray-600';
  }
  return isActive
    ? 'bg-blue-600 text-white ring-1 ring-inset ring-blue-300'
    : 'bg-gray-700 border border-blue-500/30 text-blue-100 hover:bg-gray-600';
}

function SourceIcon({ video, size = 12 }) {
  if (video.placedAtEnd) return <Clock size={size} className="shrink-0 text-amber-300" />;
  if (video.kind === 'angle') return <Video size={size} className="shrink-0" />;
  return <Film size={size} className="shrink-0" />;
}

function segmentTitle(video, isActive) {
  if (video.placedAtEnd && !isActive) return ANNOTATE.appendedFootageTitle(video.name);
  return video.coversPlayhead && !isActive
    ? ANNOTATE.switchHereTitle(video.name)
    : ANNOTATE.jumpToVideoTitle(video.name);
}

export default function SourceBar({
  videos = [],
  activeSequence = null,
  index = 1,
  count = 0,
  notice = null,
  pulseSequence = null,
  pulseNonce = 0,
  onPick,
  onFixTiming,
  // Fullscreen transport styling (same as AnnotateControls' fullscreen surface).
  compact = false,
}) {
  const [open, setOpen] = useState(false);
  const [listPos, setListPos] = useState(null);
  // T13280 follow-up: the 2-3-video row's own expand/collapse state, independent of
  // the 4+ case's portalled `open`. User-toggled via the compact trigger; also forced
  // open by a genuine conflict at the playhead regardless of this flag (see `expanded`).
  const [userExpanded, setUserExpanded] = useState(false);
  const triggerRef = useRef(null);
  const listRef = useRef(null);

  // Any outside pointerdown or scroll dismisses the 4+ list.
  useEffect(() => {
    if (!open) return;
    const dismiss = (e) => {
      if (listRef.current?.contains(e.target) || triggerRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    window.addEventListener('pointerdown', dismiss, true);
    window.addEventListener('scroll', dismiss, true);
    return () => {
      window.removeEventListener('pointerdown', dismiss, true);
      window.removeEventListener('scroll', dismiss, true);
    };
  }, [open]);

  if (videos.length < 2) return null;

  const active = videos.find((v) => v.sequence === activeSequence) ?? videos[0];
  const activeIdx = videos.indexOf(active);
  // T13280 follow-up: any non-original video can be repositioned, not just angles.
  const fixable = videos.filter((v) => v.virtualStart > 0);

  const pick = (seq) => {
    setOpen(false);
    setUserExpanded(false);
    onPick?.(seq);
  };

  // T13280 follow-up: a genuine conflict exists right now -- another source covers
  // this exact moment, so there IS something to switch to in place. Forces the 2-3
  // row open regardless of `userExpanded`.
  const hasConflict = videos.some((v) => v.coversPlayhead && v.sequence !== active.sequence);
  const expanded = hasConflict || userExpanded;

  const surface = compact
    ? 'py-0.5 bg-gray-900/90'
    : 'py-1 bg-gray-800 border-t border-gray-700/60 rounded-b-lg';
  const rowClass = `flex items-center gap-2 px-2 lg:px-4 min-h-[40px] coarse-pointer:min-h-[52px] ${surface}`;

  // T13280 follow-up: reachable for ANY active video that isn't the game's own
  // original recording (virtualStart 0) -- an angle (line it up by ear) or a
  // sequential/appended one (drag it on the VideoLane, or nudge it here).
  const fixButton = onFixTiming && active.virtualStart > 0 ? (
    <button
      type="button"
      data-testid="source-bar-fix-timing"
      aria-label={ANNOTATE.fixTimingFor(active.name)}
      title={ANNOTATE.fixTimingFor(active.name)}
      onClick={() => onFixTiming(active.sequence)}
      className="shrink-0 inline-flex items-center justify-center w-8 h-8 coarse-pointer:w-11 coarse-pointer:h-11 rounded text-yellow-300 hover:bg-gray-700 transition-colors"
    >
      <Clock size={16} />
    </button>
  ) : null;

  const renderSegment = (v) => {
    const isActive = v.sequence === active.sequence;
    const isPulsing = v.sequence === pulseSequence;
    return (
      <button
        // The nonce in the key re-mounts a re-tapped segment so the pulse restarts.
        key={`${v.sequence}-${isPulsing ? pulseNonce : 0}`}
        type="button"
        data-testid={`source-seg-${v.sequence}`}
        data-kind={v.kind}
        aria-pressed={isActive}
        title={segmentTitle(v, isActive)}
        onClick={() => pick(v.sequence)}
        className={`flex items-center justify-center gap-1 px-2 min-w-0 min-h-[32px] coarse-pointer:min-h-[44px] rounded text-xs font-medium transition-colors ${segmentClasses(v.kind, isActive)} ${isPulsing ? PULSE_CLASS : ''}`}
      >
        <SourceIcon video={v} />
        <span className="truncate">{v.name}</span>
        {v.coversPlayhead && !isActive && (
          <ArrowLeftRight size={12} data-testid={`source-swap-${v.sequence}`} className="shrink-0 opacity-80" aria-hidden="true" />
        )}
      </button>
    );
  };

  if (videos.length <= MAX_SEGMENTS) {
    if (!expanded) {
      // At rest, nothing covers the playhead right now: a compact trigger, so the bar
      // stays out of the way. Tapping it (or reaching a genuine conflict) expands it.
      return (
        <div data-testid="source-bar" role="group" aria-label={ANNOTATE.VIDEOS_HELP} className={rowClass}>
          <button
            type="button"
            data-testid="source-trigger"
            aria-expanded={false}
            onClick={() => setUserExpanded(true)}
            className="flex-1 min-w-0 flex items-center gap-1.5 px-2 min-h-[32px] coarse-pointer:min-h-[44px] rounded bg-gray-700 text-xs text-blue-100 hover:bg-gray-600 transition-colors"
          >
            <SourceIcon video={active} />
            <span data-testid="source-readout" data-notice={notice ? 'true' : 'false'} className="truncate">
              {notice ?? ANNOTATE.videoPosition(index, count)}
            </span>
            <ChevronDown size={12} className="ml-auto shrink-0" />
          </button>
          {fixButton}
        </div>
      );
    }
    return (
      <div data-testid="source-bar" role="group" aria-label={ANNOTATE.VIDEOS_HELP} className={`relative ${rowClass}`}>
        <button
          type="button"
          data-testid="source-collapse"
          aria-expanded={true}
          aria-label={ANNOTATE.VIDEOS_LABEL}
          disabled={hasConflict}
          onClick={() => setUserExpanded(false)}
          className="shrink-0 disabled:cursor-default"
        >
          <Film size={14} className="text-blue-400" aria-hidden="true" />
        </button>
        {/* The readout is inline from `sm` up ("Video 2 of 2" at rest, the notice for
            1.5s after a tap). On a phone the filled segment already says which video
            at rest, and an inline notice would squeeze the segments to a few letters,
            so there the notice floats over the bar's top edge instead: no layout
            shift, and still on every width, so a tap is never silent. */}
        <span
          data-testid="source-readout"
          data-notice={notice ? 'true' : 'false'}
          className={`hidden sm:inline text-xs font-medium whitespace-nowrap ${notice ? 'text-white' : 'text-gray-400'}`}
        >
          {notice ?? ANNOTATE.videoPosition(index, count)}
        </span>
        {notice && (
          <span
            data-testid="source-notice-float"
            className="sm:hidden pointer-events-none absolute left-1/2 -top-3 z-10 -translate-x-1/2 whitespace-nowrap rounded-md bg-gray-900/95 px-2 py-0.5 text-xs font-medium text-white shadow-lg"
          >
            {notice}
          </span>
        )}
        <div
          className="flex-1 grid gap-1 min-w-0"
          style={{ gridTemplateColumns: `repeat(${videos.length}, minmax(0, 1fr))` }}
        >
          {videos.map(renderSegment)}
        </div>
        {fixButton}
      </div>
    );
  }

  // 4+ videos: trigger + prev/next + portalled list.
  const toggleList = () => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (r) setListPos({ left: r.left, top: r.bottom + 4, width: r.width });
    setOpen((o) => !o);
  };
  const navClass = 'shrink-0 inline-flex items-center justify-center w-8 h-8 coarse-pointer:w-11 coarse-pointer:h-11 rounded bg-gray-700 text-gray-200 hover:bg-gray-600 disabled:opacity-40 disabled:hover:bg-gray-700 transition-colors';

  return (
    <div data-testid="source-bar" role="group" aria-label={ANNOTATE.VIDEOS_HELP} className={rowClass}>
      <button
        type="button"
        data-testid="source-prev"
        aria-label={ANNOTATE.PREV_VIDEO}
        title={ANNOTATE.PREV_VIDEO}
        disabled={activeIdx <= 0}
        onClick={() => pick(videos[activeIdx - 1].sequence)}
        className={navClass}
      >
        <ChevronLeft size={16} />
      </button>
      <button
        ref={triggerRef}
        type="button"
        data-testid="source-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={toggleList}
        className="flex-1 min-w-0 flex items-center gap-1.5 px-2 min-h-[32px] coarse-pointer:min-h-[44px] rounded bg-gray-700 text-xs text-blue-100 hover:bg-gray-600 transition-colors"
      >
        <SourceIcon video={active} />
        <span data-testid="source-readout" data-notice={notice ? 'true' : 'false'} className="truncate">
          {notice ?? ANNOTATE.watchingSource(active.name)}
        </span>
        <ChevronDown size={12} className={`ml-auto shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      <button
        type="button"
        data-testid="source-next"
        aria-label={ANNOTATE.NEXT_VIDEO}
        title={ANNOTATE.NEXT_VIDEO}
        disabled={activeIdx >= videos.length - 1}
        onClick={() => pick(videos[activeIdx + 1].sequence)}
        className={navClass}
      >
        <ChevronRight size={16} />
      </button>
      {fixButton}
      {/* Portal to document.body: the player has transformed ancestors, so a `fixed`
          list inside it would drift (T5700/T8600/T8900 landmine, see AngleLanes). */}
      {open && listPos && createPortal(
        <div
          ref={listRef}
          data-testid="source-list"
          role="listbox"
          className="fixed z-50 rounded-lg bg-gray-900 border border-gray-700 shadow-xl py-1 text-xs"
          style={{ left: listPos.left, top: listPos.top, minWidth: Math.max(180, listPos.width) }}
        >
          {videos.map((v) => {
            const isActive = v.sequence === active.sequence;
            return (
              <button
                key={v.sequence}
                type="button"
                role="option"
                aria-selected={isActive}
                data-testid={`source-seg-${v.sequence}`}
                data-kind={v.kind}
                title={segmentTitle(v, isActive)}
                onClick={() => pick(v.sequence)}
                className={`flex w-full items-center gap-1.5 px-3 py-2 coarse-pointer:min-h-[44px] text-left transition-colors ${
                  isActive
                    ? (v.kind === 'angle' ? 'bg-violet-600 text-white' : 'bg-blue-600 text-white')
                    : (v.kind === 'angle' ? 'text-violet-200 hover:bg-gray-800' : 'text-blue-100 hover:bg-gray-800')
                }`}
              >
                <SourceIcon video={v} />
                <span className="truncate">{v.name}</span>
                {v.coversPlayhead && !isActive && (
                  <ArrowLeftRight size={12} data-testid={`source-swap-${v.sequence}`} className="ml-auto shrink-0 opacity-80" aria-hidden="true" />
                )}
              </button>
            );
          })}
          {onFixTiming && fixable.length > 0 && (
            <div className="mt-1 border-t border-gray-700 pt-1">
              {fixable.map((a) => (
                <button
                  key={`fix-${a.sequence}`}
                  type="button"
                  data-testid={`source-fix-timing-${a.sequence}`}
                  onClick={() => { setOpen(false); onFixTiming(a.sequence); }}
                  className="flex w-full items-center gap-1.5 px-3 py-2 coarse-pointer:min-h-[44px] text-left text-yellow-200 hover:bg-gray-800 transition-colors"
                >
                  <Clock size={12} className="shrink-0" />
                  <span className="truncate">{ANNOTATE.fixTimingFor(a.name)}</span>
                </button>
              ))}
            </div>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
