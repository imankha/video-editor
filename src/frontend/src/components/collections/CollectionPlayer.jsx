import React, { useRef, useEffect, useCallback, useState } from 'react';
import { X, Download, Loader, Pencil, Scale, Share2, FolderInput, Play, Pause, Maximize, Minimize } from 'lucide-react';
import { Button } from '../shared/Button';
import { Z } from '../../constants/zLayers';
import { RATIO } from '../../constants/aspectRatios';
import { LIBRARY_ACTIONS, RESULT_SURFACE } from '../../config/displayNames';
import { useStoryPlayback } from './useStoryPlayback';
import { formatGameClock } from '../../utils/timeFormat';
import { canReEditReel } from '../../utils/reelReEditable';
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
 * @param {boolean=}  shareRing     - T8530: a one-shot attention ring on the Share button
 *                                     right after a publish swaps Publish->Share, so the
 *                                     swap is noticed. The caller clears it on a timer/first
 *                                     interaction.
 * @param {Function=} onPublish     - () => void; T8530: shows the PRIMARY Publish button
 *                                     when set. Occupies the SAME primary slot as Share
 *                                     (the draft state's occupant; Share is the published
 *                                     state's). The caller (DraftReelPreview) owns the
 *                                     publish logic; this component stays presentational.
 * @param {boolean=}  publishLoading - spins + disables Publish
 * @param {ReactNode=} statusBanner  - T8530: optional full-width row rendered between the
 *                                     header and the video area (the draft/failure strip).
 *                                     A slot, not a boolean+copy, so the player never learns
 *                                     product vocabulary and the caller owns the tint swap.
 * @param {ReactNode=} actionBar     - T8390: optional full-width row rendered AFTER the video
 *                                     area (a footer, opposite end from statusBanner). A slot,
 *                                     not a fixed button set, so the player stays presentational
 *                                     and product-vocabulary-free — the caller (FocusScreen, for
 *                                     its post-export publish exit) owns the actual buttons/copy.
 *                                     Omitted -> no-op, byte-identical to today for every other
 *                                     caller (DraftReelPreview, DownloadsPanel, etc.).
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
 * @param {boolean=} transport     - T10680: default true. Adds the on-screen transport affordances a
 *                                     finished-reel player should carry: a center play/pause glyph
 *                                     inside the tap/swipe zone (persistent Play while paused, a Pause
 *                                     flashed for one beat then faded on the play edge; pointer-events-none
 *                                     so it never steals the center-tap toggle), plus header Play/Pause and
 *                                     Fullscreen icon buttons before Close. Fullscreen = CSS expand
 *                                     (`expanded` fills the panel and drops the actionBar footer) layered
 *                                     with native `requestFullscreen` on the PANEL where available, and
 *                                     iPhone's `video.webkitEnterFullscreen()` where it is not. Escape
 *                                     leaves fullscreen first (closes only on a second press). When false
 *                                     the glyph, both buttons, the expand state and the Escape guard are
 *                                     all absent. Kept ON for every finished-reel caller including the
 *                                     IntroStoryPlayer-mounted Published/Downloads players (see
 *                                     `fullscreenTarget`); it is NOT opted out there.
 * @param {object=} fullscreenTarget - T10680: optional ref to an ancestor element to request NATIVE
 *                                     fullscreen on instead of the panel. IntroStoryPlayer needs this:
 *                                     its composite scrubber is a SIBLING of the panel (a separate
 *                                     fixed z-90 container), so native fullscreen on the panel alone
 *                                     would drop the bar. It points this at a wrapper enclosing BOTH the
 *                                     panel and the scrubber. Omitted -> native fullscreen targets the
 *                                     panel (byte-identical for every standalone caller). The CSS
 *                                     `expanded` path is unaffected either way.
 * @param {Function=} onBackToGame   - T10190: () => void; shows a "Back to game plays" affordance next
 *                                     to the header title when set. CollectionPlayer stays presentational
 *                                     -- it renders purely off whether the prop is passed, never off reel
 *                                     shape; the caller (DraftReelPreview/FocusScreen/OverlayScreen) gates
 *                                     on resolving exactly one source game and builds the handler (design
 *                                     §2.4). Omitted -> no affordance, byte-identical for every caller that
 *                                     never passes it (public /shared viewer, Published/IntroStoryPlayer,
 *                                     DownloadsPanel, RankingGame).
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
  shareRing = false,
  onPublish,
  publishLoading,
  statusBanner,
  actionBar,
  onDownload,
  downloadLoading,
  onReEdit,
  reEditLoadingId,
  onReRank,
  reRankLoadingId,
  handleGlyph,
  renderScrubber = true,
  transport = true,
  fullscreenTarget = null,
  onBackToGame,
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
  // T9470: a slow or failed stream must offer a way out instead of an indefinite
  // skeleton. `loadError` flips on the <video> error event (failed load);
  // `stalled` flips if the first frame has not painted after STALL_MS (slow
  // load). Either one surfaces the retry overlay below. `reloadNonce` re-arms the
  // reset/stall effects on Retry even though the src (identity) is unchanged.
  const [loadError, setLoadError] = useState(false);
  const [stalled, setStalled] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);
  // T10680 transport: `expanded` drives the CSS fullscreen (panel fills, footer
  // drops); `glyphFaded` fades the center glyph one beat after the play edge.
  const [expanded, setExpanded] = useState(false);
  const [glyphFaded, setGlyphFaded] = useState(false);

  const handleAllEnded = useCallback(() => onEnded?.(), [onEnded]);
  const handleReelChange = useCallback(
    (index, reel) => onReelChange?.(index, reel),
    [onReelChange],
  );

  const {
    activeIndex,
    activeReel,
    isPlaying,
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

  // T10680 fullscreen. Primary mechanism is our CSS `expanded` (fills the panel,
  // drops the footer — works everywhere); native fullscreen is layered on where
  // the browser has it. On the PANEL (not the <video>) so our scrubber/header/
  // glyph stay visible. iPhone Safari has no Element.requestFullscreen — its only
  // fullscreen is the native video player via webkitEnterFullscreen; there we do
  // NOT set `expanded` (the native player covers everything and returns cleanly).
  // Every native call is guarded with ?. (jsdom has none).
  const enterFullscreen = useCallback(() => {
    const video = videoRef.current;
    if (!document.fullscreenEnabled && typeof video?.webkitEnterFullscreen === 'function') {
      video.webkitEnterFullscreen();
      return;
    }
    setExpanded(true);
    // Native fullscreen on the caller-provided ancestor when given (IntroStoryPlayer,
    // whose composite scrubber sits OUTSIDE the panel), else the panel itself.
    // requestFullscreen returns a promise that rejects when the browser refuses
    // (no user activation, blocked in an iframe, etc.); swallow it — the CSS
    // `expanded` fallback already gives the big view, so a refused native request
    // must not surface as an unhandled rejection.
    const target = fullscreenTarget?.current ?? panelRef.current;
    target?.requestFullscreen?.()?.catch?.(() => {});
  }, [fullscreenTarget]);

  const exitFullscreen = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen?.()?.catch?.(() => {});
    setExpanded(false);
  }, []);

  const toggleExpanded = useCallback(() => {
    if (expanded) exitFullscreen();
    else enterFullscreen();
  }, [expanded, enterFullscreen, exitFullscreen]);

  // Reflect a browser-initiated fullscreen exit (Esc, the browser's own control)
  // back into `expanded` so the layout collapses when the native element leaves.
  useEffect(() => {
    if (!transport) return undefined;
    const onFsChange = () => {
      if (!document.fullscreenElement) setExpanded(false);
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, [transport]);

  // Unmount while in native fullscreen: exit it so we don't leave the browser
  // stuck fullscreen over whatever renders next.
  useEffect(() => {
    return () => {
      if (document.fullscreenElement) document.exitFullscreen?.()?.catch?.(() => {});
    };
  }, []);

  // T10680 glyph fade: persistent Play while paused; on the paused->playing edge
  // flash the Pause glyph for one beat, then fade it out (600ms). One setTimeout,
  // cleared on the next edge / unmount. No rAF, no new loop.
  useEffect(() => {
    if (!transport) return undefined;
    if (!isPlaying) { setGlyphFaded(false); return undefined; }
    setGlyphFaded(false);
    const timer = setTimeout(() => setGlyphFaded(true), 600);
    return () => clearTimeout(timer);
  }, [transport, isPlaying]);

  // Keyboard: arrows navigate, space toggles, escape closes. T10680 Escape guard:
  // while expanded, Escape leaves fullscreen first and does NOT close — the player
  // closes only on a second Escape (matches native fullscreen exit expectations).
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); next(); }
      else if (e.key === ' ') { e.preventDefault(); togglePlay(); }
      else if (e.key === 'Escape') {
        e.preventDefault();
        if (transport && expanded) { exitFullscreen(); return; }
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next, prev, togglePlay, onClose, transport, expanded, exitFullscreen]);

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

  // Reset the skeleton (and any prior load-failure/stall state) whenever the
  // source changes so a newly-loaded reel waits for its own first paintable frame
  // instead of flashing the prior video. reloadNonce re-runs this on an explicit
  // Retry too (the src is unchanged, so the dep needs the nonce).
  useEffect(() => {
    setVideoReady(false);
    setLoadError(false);
    setStalled(false);
  }, [activeReel?.streamUrl, reloadNonce]);

  // T9470: slow-load detection. If the active reel has not painted its first
  // frame within STALL_MS, surface the retry overlay alongside the skeleton so a
  // stuck stream is never an indefinite dead-end. Cleared/re-armed on ready,
  // source change, or Retry.
  useEffect(() => {
    if (videoReady || loadError) return undefined;
    const STALL_MS = 10000;
    const timer = setTimeout(() => setStalled(true), STALL_MS);
    return () => clearTimeout(timer);
  }, [videoReady, loadError, activeReel?.streamUrl, reloadNonce]);

  // Retry a failed/stalled load: reset the gates and force the element to re-fetch
  // (the src is unchanged, so React alone won't reload it — .load() re-attempts).
  const handleReload = useCallback(() => {
    setLoadError(false);
    setStalled(false);
    setVideoReady(false);
    setReloadNonce((n) => n + 1);
    videoRef.current?.load?.();
  }, []);

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
        className={`fixed inset-0 ${Z.PLAYER} bg-black flex flex-col select-none outline-none ${
          expanded ? 'rounded-none' : 'md:inset-12 md:rounded-xl md:overflow-hidden'
        }`}>
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
        <div className="flex items-center gap-3 min-w-0">
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
          {/* T10190 §2.4: a NAMED backlink control, not the title itself made
              clickable -- keeps the title purely informational (read as a
              heading) and the backlink a distinct button with its own
              accessible name. Renders iff the caller passes onBackToGame;
              this component does no gating on reel shape (that's the
              caller's job -- single-source-game check). */}
          {onBackToGame && (
            <button
              type="button"
              onClick={onBackToGame}
              title={RESULT_SURFACE.BACK_TO_GAME}
              className="shrink-0 text-xs text-cyan-300 hover:text-cyan-200 underline underline-offset-2 truncate"
            >
              {RESULT_SURFACE.BACK_TO_GAME}
            </button>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* T8530: Publish is the PRIMARY action in the DRAFT state — first in the
              cluster, occupying the same slot Share takes once published. Labeled
              cyan button; the full gesture name lives in title/aria-label since the
              label is shortened to fit the toolbar. coarse-pointer:min-h-11 floors
              the 34px labeled button to the 44px touch target. State-exclusive with
              onShare (the caller passes exactly one of them per publish state). */}
          {onPublish && (
            <Button
              variant="cyan"
              size="sm"
              icon={FolderInput}
              loading={publishLoading}
              onClick={onPublish}
              title={LIBRARY_ACTIONS.PUBLISH_REEL}
              aria-label={LIBRARY_ACTIONS.PUBLISH_REEL}
              className="coarse-pointer:min-h-11"
            >
              Publish
            </Button>
          )}
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
              className={shareRing ? 'ring-2 ring-cyan-400/70 animate-pulse' : ''}
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
              demoted to the toolbar's tertiary/icon-only end, behind Share+Download.
              T11220: canReEditReel also hides it for a legacy multi-clip reel
              (clip_count > 1) — the single-clip editor can't edit those. */}
          {onReEdit && canReEditReel(activeReel) ? (
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
          {/* T10680: header transport — Play/Pause + Fullscreen, same ghost/sm/
              iconOnly shape as Re-edit/Re-rank/Close, appended immediately BEFORE
              Close. coarse-pointer:min-h-11 floors the touch target to 44px.
              Present only when `transport` (default true); absent for the
              IntroStoryPlayer opt-out so that caller is byte-identical. */}
          {transport && (
            <>
              <Button
                variant="ghost"
                size="sm"
                icon={isPlaying ? Pause : Play}
                iconOnly
                onClick={togglePlay}
                title={isPlaying ? 'Pause' : 'Play'}
                aria-label={isPlaying ? 'Pause' : 'Play'}
                className="coarse-pointer:min-h-11"
              />
              <Button
                variant="ghost"
                size="sm"
                icon={expanded ? Minimize : Maximize}
                iconOnly
                onClick={toggleExpanded}
                title={expanded ? 'Exit fullscreen' : 'Fullscreen'}
                aria-label={expanded ? 'Exit fullscreen' : 'Fullscreen'}
                className="coarse-pointer:min-h-11"
              />
            </>
          )}
          {/* T7730: icon-only close button had no text/aria-label, so it had no
              accessible name at all (screen readers + role-based selectors could
              not find it). */}
          <Button variant="ghost" size="sm" icon={X} iconOnly onClick={onClose} aria-label="Close" />
        </div>
      </div>

      {/* T8530: optional full-width status row between the header and the video.
          The caller (DraftReelPreview) owns its content/tint: cyan draft strip,
          amber retry surface on publish failure, or nothing once published. */}
      {statusBanner}

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
            className={`absolute animate-pulse rounded-lg bg-white/5 flex items-center justify-center ${
              isPortrait ? 'h-full aspect-[9/16]' : 'w-full aspect-video'
            }`}
          >
            <span className="text-xs text-gray-400">{RESULT_SURFACE.LOADING}</span>
          </div>
        )}

        <video
          ref={videoRef}
          data-testid="collection-player-video"
          src={activeReel.streamUrl}
          playsInline
          autoPlay
          onLoadedData={() => setVideoReady(true)}
          onError={() => setLoadError(true)}
          className={`max-h-full max-w-full object-contain transition-opacity duration-150 ${
            isPortrait ? 'h-full' : 'w-full'
          } ${videoReady ? 'opacity-100' : 'opacity-0'}`}
        />

        {/* T9470: retry surface for a failed (onError) or slow (STALL_MS) load,
            shown over the skeleton until the first frame paints. Additive: it never
            appears on a healthy load, so every existing caller is unchanged in the
            happy path. */}
        {(loadError || stalled) && !videoReady && (
          <div
            data-testid="collection-player-load-error"
            className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center px-6"
            role="alert"
          >
            <span className="text-sm text-gray-200">
              {loadError ? RESULT_SURFACE.LOAD_ERROR : 'Still loading...'}
            </span>
            <Button variant="secondary" size="sm" title="Retry" onClick={handleReload}>
              Retry
            </Button>
          </div>
        )}

        {/* T10680: center play/pause glyph, INSIDE the tap/swipe container so it
            never intercepts the center-tap toggle (pointer-events-none). Persistent
            Play at rest while paused (also the cue when the browser blocks unmuted
            autoplay); a Pause flashed for one beat then faded after the play edge.
            aria-hidden — the accessible control is the header button above. */}
        {transport && (
          <div
            data-testid="collection-player-play-glyph"
            aria-hidden="true"
            className={`absolute inset-0 flex items-center justify-center pointer-events-none transition-opacity duration-500 ${
              glyphFaded ? 'opacity-0' : 'opacity-100'
            }`}
          >
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm ring-1 ring-white/20">
              {isPlaying ? <Pause size={32} /> : <Play size={32} className="ml-1" />}
            </div>
          </div>
        )}

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

      {/* T8390: optional full-width footer rendered after the video area — the
          mirror of statusBanner (header side). The caller (FocusScreen) owns
          content/behavior; this component just reserves the slot. T10680: while
          `expanded` (fullscreen), the footer is dropped so the portrait video
          fills the panel; header + scrubber stay. */}
      {expanded ? null : actionBar}

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
