import React, { useRef, useEffect, useCallback, useState } from 'react';
import { X, Download, Loader, Pencil, Scale, Share2 } from 'lucide-react';
import { Button } from '../shared/Button';
import { Z } from '../../constants/zLayers';
import { RATIO } from '../../constants/aspectRatios';
import { useStoryPlayback } from './useStoryPlayback';
import { formatGameClock } from '../../utils/timeFormat';
import { PlayheadHandle } from '../shared/PlayheadHandle';
import { CompositeScrubber } from '../introcards/CompositeScrubber';

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
 * @param {Function=} onShare       - (activeReel) => void; T8540: shows the PRIMARY Share
 *                                     button when set. Renders for every reel (no gating,
 *                                     unlike Re-rank/Re-edit) -- the caller owns the actual
 *                                     share/copy split (see DownloadsPanel's `useWebShare`
 *                                     usage), this component only surfaces the gesture.
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
 * @param {string=}  handleGlyph    - T6320: sport-ball playhead glyph for the ACTIVE segment
 *                                     only (e.g. '⚽'). Absent -> no handle at all (byte-identical
 *                                     to before this task). Caller resolves the sport and passes a
 *                                     plain string — this component stays store-free. Currently
 *                                     wired only from DownloadsPanel (My Reels); the public share
 *                                     viewer, RankingGame, and the diag harness omit it on purpose.
 * @param {boolean=} renderScrubber - T6710: default true. When false, suppresses the internal
 *                                     segmented bar entirely — used by IntroStoryPlayer, which
 *                                     supplies its own single composite bar spanning the intro
 *                                     AND the reels. Every other caller omits this prop and keeps
 *                                     today's internal bar, now rendered via the shared weighted
 *                                     CompositeScrubber (proportional widths, §7.3 Option B) instead
 *                                     of the old equal-width flex-1 cells.
 * @param {number|null=} initialSeekFraction - T6710: fraction (0..1) of `initialIndex`'s reel to
 *                                     seek to, applied via the SAME `goTo` the internal bar's
 *                                     click-to-seek uses (no second seek mechanism). Used by
 *                                     IntroStoryPlayer to land a cross-boundary scrub (from the
 *                                     intro into the reels) at the right offset instead of always
 *                                     restarting reel 0 from 0. Omitted/null -> today's behavior
 *                                     (plain mount at initialIndex, no extra seek).
 * @param {number=}  landingToken   - T6710: monotonic counter bumped by IntroStoryPlayer on every
 *                                     distinct scrub/handoff gesture. Re-applies `initialIndex`/
 *                                     `initialSeekFraction` whenever this token changes, even if the
 *                                     new (index, fraction) pair has the SAME numeric value as the
 *                                     previously-applied one (e.g. scrubbing to reel 0 @0.4 twice in
 *                                     a row) -- a value-equality guard alone silently drops the second
 *                                     gesture. Omitted -> defaults to 0, so a caller that never passes
 *                                     it (every caller but IntroStoryPlayer) gets the one-shot mount
 *                                     behavior unchanged.
 * @param {Function=} onProgress    - T6710: `({ activeIndex, segmentProgress })`, fired on the SAME
 *                                     rAF tick useStoryPlayback already drives internally (no second
 *                                     rAF loop) whenever live reel progress changes. Lets a composite
 *                                     bar (IntroStoryPlayer, rendered with renderScrubber=false) fill
 *                                     the correct reel segment while this component's OWN internal bar
 *                                     stays suppressed. Omitted -> no-op (every other caller keeps its
 *                                     own internal bar, which reads activeIndex/segmentProgress directly).
 */
export function CollectionPlayer({
  reels,
  initialIndex = 0,
  initialSeekFraction = null,
  landingToken = 0,
  onProgress,
  title,
  onClose,
  onReelChange,
  onEnded,
  onShare,
  onDownload,
  downloadLoading,
  onReEdit,
  reEditLoadingId,
  onReRank,
  reRankLoadingId,
  handleGlyph,
  renderScrubber = true,
}) {
  const videoRef = useRef(null);
  const panelRef = useRef(null);
  const pointerStart = useRef(null);
  // Ephemeral view state: which timeline segment the cursor is over (tooltip).
  const [hoverIndex, setHoverIndex] = useState(null);
  // The video paints a partial "slice" before it knows its dimensions; hold a
  // skeleton in the reserved aspect box until the element can actually paint
  // (loadeddata), then reveal the real frame — no fabricated placeholder frame.
  const [videoReady, setVideoReady] = useState(false);

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
    goTo,
    togglePlay,
  } = useStoryPlayback(videoRef, reels, {
    initialIndex,
    onAllEnded: handleAllEnded,
    onReelChange: handleReelChange,
  });

  // T6710 / MAJOR #4: apply a cross-boundary landing fraction from a composite
  // scrubber (IntroStoryPlayer) via the SAME goTo the internal bar's
  // click-to-seek already uses — no second seek mechanism. Re-applies whenever
  // `landingToken` changes, NOT on value-equality of (initialIndex,
  // initialSeekFraction) alone — a value-keyed guard silently drops a repeat
  // scrub to the same (index, fraction) as a prior one (e.g. scrub to reel 0
  // @0.4, let it play forward, then scrub BACK to reel 0 @0.4 again), because
  // the second gesture's key matches the first. The token is a distinct
  // per-gesture identity, so every scrub is honored regardless of where it lands.
  const appliedTokenRef = useRef(null);
  useEffect(() => {
    if (initialSeekFraction == null) return;
    if (appliedTokenRef.current === landingToken) return;
    appliedTokenRef.current = landingToken;
    goTo(initialIndex, initialSeekFraction);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [landingToken, initialSeekFraction]);

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

  // Modal contract: lock background scroll while the player is open so the
  // page behind can't move under the fixed overlay. Restored on close/unmount.
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prevOverflow; };
  }, []);

  // Modal contract: focus trap. Move focus into the dialog on open and keep Tab
  // cycling within it, so background tiles/carousel are out of the tab order for
  // keyboard users (the pointer-side equivalent is the backdrop below).
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    panel.focus();
    const onKeyDown = (e) => {
      if (e.key !== 'Tab') return;
      const focusables = Array.from(
        panel.querySelectorAll(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null || el === panel);
      if (focusables.length === 0) { e.preventDefault(); panel.focus(); return; }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === panel)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    panel.addEventListener('keydown', onKeyDown);
    return () => panel.removeEventListener('keydown', onKeyDown);
  }, []);

  // Reset the skeleton whenever the source changes so a newly-loaded reel also
  // waits for its first paintable frame instead of flashing the prior video.
  useEffect(() => { setVideoReady(false); }, [activeReel?.streamUrl]);

  // BLOCKING #2: surface live reel progress to a composite bar (IntroStoryPlayer)
  // whenever it changes. `activeIndex`/`segmentProgress` are ALREADY driven by
  // useStoryPlayback's own rAF tick above — this reports that same state on
  // React's normal render cycle, it does not add a second rAF loop or re-derive
  // playback position; useStoryPlayback remains the one owner of both values.
  useEffect(() => {
    onProgress?.({ activeIndex, segmentProgress });
  }, [activeIndex, segmentProgress, onProgress]);

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

  // Tooltip / accessible label for a timeline segment. Mirrors the header:
  // game name + in-match clock (T3920), falling back to the reel's own name.
  const reelLabel = (reel) => {
    if (reel.gameName) {
      const clock = formatGameClock(reel.gameStartTime);
      return clock ? `${reel.gameName} ${clock}` : reel.gameName;
    }
    return reel.name || title;
  };

  if (!activeReel) return null;

  const isPortrait = activeReel.aspect_ratio === RATIO.PORTRAIT;

  return (
    <>
      {/* Backdrop (T5860): opaque black beneath the panel so the desktop
          md:inset-12 gutter never exposes the My Reels tiles/carousel behind
          it. It SWALLOWS pointer events (no pass-through to tiles) and, per
          project rule, does NOT close the player on click — a misclick in the
          gutter must not dismiss. Close is via the X button / Escape only. */}
      <div
        data-testid="collection-player-backdrop"
        className={`fixed inset-0 ${Z.OVERLAY_BACKDROP} bg-black`}
        onClick={(e) => { e.stopPropagation(); }}
        onPointerDown={(e) => { e.stopPropagation(); }}
        onPointerUp={(e) => { e.stopPropagation(); }}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`fixed inset-0 ${Z.PLAYER} bg-black flex flex-col select-none outline-none md:inset-12 md:rounded-xl md:overflow-hidden`}>
      {/* Segmented progress bar — each segment is a scrub target: hover shows the
          reel name, click jumps to that reel and seeks to the clicked fraction.
          The visible bar stays 4px; a taller transparent hit region (py-2) makes
          it easy to hit (T4760 pattern) without changing the visual. T6710:
          generalized to the shared weighted CompositeScrubber (proportional
          widths, §7.3 Option B) — suppressed via renderScrubber=false when a
          composite (IntroStoryPlayer) supplies its own single bar instead. */}
      {renderScrubber && (
        <CompositeScrubber
          segments={reels.map((reel, i) => ({
            kind: 'reel',
            label: reelLabel(reel),
            durationSec: reel.duration,
            fillPercent: i < activeIndex ? 100 : i === activeIndex ? segmentProgress * 100 : 0,
          }))}
          onScrub={({ index, fraction }) => goTo(index, fraction)}
          hoverIndex={hoverIndex}
          onHoverChange={setHoverIndex}
          renderExtra={(seg, i) => (
            // T6320: the sport-ball playhead lives on the ACTIVE segment only,
            // and only when a glyph was resolved (My Reels today). Rendered as
            // a SIBLING of ProgressTrack, not nested inside it, because the
            // track clips overflow (overflow-hidden) and the ball must be
            // allowed to ride past a segment edge (Gate 3: allow overflow,
            // don't clamp) rather than being cut off. The button's symmetric
            // py-2 padding keeps top-1/2 centred on the track either way.
            i === activeIndex && handleGlyph ? (
              <PlayheadHandle
                progress={segmentProgress * 100}
                glyph={handleGlyph}
                size={{ box: 16, font: 14 }}
              />
            ) : null
          )}
        />
      )}

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
          {/* T8540: Share is the player's PRIMARY action -- one tap, no overflow
              menu (prod cliff 4: zero real users ever completed a share from
              here). Renders for every reel, unlike Re-rank -- the caller (not
              this component) owns the coarse/fine Web-Share-vs-Copy-Link split. */}
          {onShare && (
            <Button
              variant="primary"
              size="sm"
              icon={Share2}
              onClick={() => onShare(activeReel)}
              title="Share"
            >
              Share
            </Button>
          )}
          {/* T8540: demoted from primary to secondary now that Share leads. */}
          {onDownload && (
            <Button
              variant="secondary"
              size="sm"
              icon={downloadLoading ? Loader : Download}
              disabled={downloadLoading}
              onClick={() => onDownload(activeReel)}
              className={downloadLoading ? '[&_svg]:animate-spin' : ''}
            >
              {downloadLoading ? 'Downloading...' : 'Download'}
            </Button>
          )}
          {/* T3940: jump straight into THIS reel's editor (acts on the active reel).
              Gated on the prop (public viewer omits it) AND an editable project
              (project_id null/0 -> non-editable export, button hidden). T8540:
              demoted to the toolbar's tertiary/icon-only end, behind Share+Download. */}
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
              editable project -- Mixes/multi-clip never rank, so the control hides.
              T8540: demoted to the toolbar's tertiary/icon-only end (gating unchanged). */}
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
          {/* T7730: icon-only close button had no text/aria-label, so it had no
              accessible name at all (screen readers + role-based selectors could
              not find it). */}
          <Button variant="ghost" size="sm" icon={X} iconOnly onClick={onClose} aria-label="Close" />
        </div>
      </div>

      {/* Video + tap/swipe zones */}
      <div
        className="relative flex-1 min-h-0 flex items-center justify-center"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
      >
        {/* Skeleton in the reserved aspect box, shown until the video can paint
            its first frame (loadeddata). Prevents the "slice of video" open —
            the element painting partially before it knows its dimensions. */}
        {!videoReady && (
          <div
            data-testid="collection-player-skeleton"
            aria-hidden="true"
            className={`absolute animate-pulse rounded-lg bg-white/5 ${
              isPortrait ? 'h-full aspect-[9/16]' : 'w-full aspect-video'
            }`}
          />
        )}

        <video
          ref={videoRef}
          data-testid="collection-player-video"
          src={activeReel.streamUrl}
          playsInline
          autoPlay
          onLoadedData={() => setVideoReady(true)}
          className={`max-h-full max-w-full object-contain transition-opacity duration-150 ${
            isPortrait ? 'h-full' : 'w-full'
          } ${videoReady ? 'opacity-100' : 'opacity-0'}`}
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
    </>
  );
}

export default CollectionPlayer;
