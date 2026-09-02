// T6710 — the composite container that replaces the DownloadsPanel swap
// ternary (design §4(iii) / §5). Owns a SINGLE `region` state ('intro' |
// 'reels') and DERIVES global position from whichever sub-clock is active —
// it never stores a second/third clock (`useStoryPlayback` stays
// byte-identical; `useIntroPlayback` is the intro's own honest clock).
//
// Boundary routing is a single comparison: `globalMs < introDurMs` -> the
// intro (arbitrary seek, decision 2) else -> the matching reel/fraction,
// forwarded to CollectionPlayer as `initialIndex`/`initialSeekFraction` (it
// owns `useStoryPlayback`, so IntroStoryPlayer never duplicates that state —
// it hands CollectionPlayer where to land, the hook does the actual seek).
// Forward auto-continue (`onIntroEnded`) and a fast forward-scrub past the
// intro both land in 'reels' without double-firing (R2) — guarded by the
// single `region` state itself (ignore onIntroEnded once region has already
// left 'intro').
//
// Stage 4.5 review fixes (post-37206397):
//  - BLOCKING #1: CompositeScrubber's own root is a plain (non-positioned)
//    <div>, so as a bare sibling of the fixed/z-layered region renderers
//    (IntroPreRoll's `fixed inset-0 z-[85]` default, CollectionPlayer's own
//    internal `fixed inset-0 ${Z.PLAYER}` panel) it painted BEHIND both and
//    was unclickable. Fix: wrap it in a `fixed inset-0 ${Z.ALERT}` container
//    here (named ladder rung, covers Z.PLAYER z-[70] and the z-[85] intro
//    default) with `pointer-events-none` on the full-viewport wrapper and
//    `pointer-events-auto` restored on the bar row itself, so the rest of the
//    viewport (the video/intro beneath) still receives clicks/taps.
//  - BLOCKING #2: reel segments now receive LIVE progress via CollectionPlayer's
//    new `onProgress({ activeIndex, segmentProgress })` callback (fired from
//    its existing useStoryPlayback-driven rAF tick -- no second rAF loop here).
//    IntroStoryPlayer stores only that minimal derived pair for rendering the
//    bar; useStoryPlayback stays the one owner of real reel playback position.
//  - MAJOR #3: drives useIntroPlayback's own `setPlaying(region === 'intro')`
//    so the intro's rAF clock is frozen the instant region leaves 'intro' (was
//    never wired -- design §5's "frozen whenever region !== 'intro'" was
//    unimplemented).
//  - MAJOR #4: `reelsLanding` is now paired with a monotonic `landingToken`
//    (bumped on every onScrub/handleIntroEnded call) instead of relying on
//    CollectionPlayer's effect re-keying off VALUE equality of
//    (initialIndex, initialSeekFraction) alone -- a repeat scrub to the exact
//    same (index, fraction) is a distinct gesture and must not be dropped.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useIntroPlayback } from './useIntroPlayback';
import { preloadIntroImage } from './preloadIntroImage';
import { IntroPreRoll } from './IntroPreRoll';
import { CollectionPlayer } from '../collections/CollectionPlayer';
import { CompositeScrubber } from './CompositeScrubber';
import { Z } from '../../constants/zLayers';

const REGION = { INTRO: 'intro', REELS: 'reels' };

function reelDurationsSec(reels) {
  return (reels || []).map((r) => r.duration || 0);
}

// Given a ms offset INTO the reels portion (already past the intro), resolve
// which reel index it falls in and the fraction (0..1) within that reel. A
// reel with no known duration (null/0) can't be measured into, so it is
// treated as the landing reel outright (frac 0) rather than silently
// swallowed — mirrors the scrubber's own presentational weight=1 fallback
// (§7.4); this math is presentational routing ONLY and never feeds
// useStoryPlayback's own progress derivation (which stays live-duration-only,
// unchanged).
function reelIdxAndFractionFor(reelsOffsetMs, durationsSec) {
  let remainingMs = reelsOffsetMs;
  for (let i = 0; i < durationsSec.length; i += 1) {
    const durMs = (durationsSec[i] || 0) * 1000;
    const isLast = i === durationsSec.length - 1;
    if (durMs <= 0) return { index: i, fraction: 0 };
    if (remainingMs < durMs || isLast) {
      return { index: i, fraction: Math.max(0, Math.min(1, remainingMs / durMs)) };
    }
    remainingMs -= durMs;
  }
  return { index: 0, fraction: 0 };
}

export function IntroStoryPlayer({
  intro,
  aspect,
  reels,
  __captureOnScrub,
  // Fullscreen fixed players stack above the panel (Z.PLAYER); mirrors
  // IntroPreRoll's own positionClassName contract (BrandedEndCard pattern).
  // Defaults to the owner in-app player's z-layer (the only caller today).
  introPositionClassName = `fixed inset-0 ${Z.INTRO}`,
  ...collectionPlayerProps
}) {
  const [region, setRegion] = useState(intro ? REGION.INTRO : REGION.REELS);
  // Synchronous mirror of `region` for handleIntroEnded's guard below — reading
  // this ref (not a setRegion functional updater) keeps that guard a plain,
  // idempotent statement rather than a state-updater with side effects, which
  // React may invoke more than once for one real event (StrictMode dev
  // double-invoke, or a Sync-lane render replaying a still-pending Default-lane
  // update) (T6730 audit finding C).
  const regionRef = useRef(region);
  regionRef.current = region;
  // Where a boundary-crossing scrub should land inside the reels region —
  // applied by CollectionPlayer's own useStoryPlayback via goTo. Paired with
  // `landingToken` (MAJOR #4) so a repeat scrub to the SAME (index, fraction)
  // as a prior one is still a distinct gesture CollectionPlayer must re-apply,
  // not a value-equality no-op.
  const [reelsLanding, setReelsLanding] = useState(null);
  const [landingToken, setLandingToken] = useState(0);

  const introDurSec = intro ? (intro.card?.duration || 4.0) : 0;
  const introDurMs = introDurSec * 1000;
  const durationsSec = useMemo(() => reelDurationsSec(reels), [reels]);

  const landInReels = useCallback((landing) => {
    setReelsLanding(landing);
    setLandingToken((t) => t + 1);
    setRegion(REGION.REELS);
  }, []);

  // Forward auto-continue: onIntroEnded -> region='reels', landing at reel 0.
  // Guarded against double-fire (R2, e.g. a fast forward-scrub past the intro
  // also reaching the clock's end) by ignoring the callback once region has
  // already left 'intro' — mirrors useStoryPlayback's pendingSeekRef
  // cancel-on-transition pattern.
  const handleIntroEnded = useCallback(() => {
    if (regionRef.current !== REGION.INTRO) return;
    setReelsLanding({ index: 0, fraction: 0 });
    setLandingToken((t) => t + 1);
    setRegion(REGION.REELS);
  }, []);

  const { introTimeMs, seekIntro, setPlaying } = useIntroPlayback(introDurSec, { onIntroEnded: handleIntroEnded });

  // T6960: hold the clock until the card's photo is fetched+decoded. Every
  // Play presigns a FRESH photo URL (cache-busting query params), so without
  // this the 4s card races a network download and often finishes photoless.
  // preloadIntroImage always resolves (error/timeout degrade to a photoless
  // card, warned) — this can delay start by at most its cap, never hang.
  const introPhotoUrl = intro?.previewUrl || null;
  const [introAssetsReady, setIntroAssetsReady] = useState(!introPhotoUrl);
  useEffect(() => {
    // Re-arm on every URL change (reviewer MAJOR-2): if this mounted player
    // ever receives a different card, the clock must re-hold for the NEW
    // photo, not start against the previous one's readiness. Mirrors
    // IntroPreRoll's gate — keep the two in step.
    if (!introPhotoUrl) {
      setIntroAssetsReady(true);
      return undefined;
    }
    let cancelled = false;
    setIntroAssetsReady(false);
    preloadIntroImage(introPhotoUrl).then(() => {
      if (!cancelled) setIntroAssetsReady(true);
    });
    return () => { cancelled = true; };
  }, [introPhotoUrl]);

  // MAJOR #3 / design §5: "the clock is frozen (no rAF advance) whenever the
  // composite's region !== 'intro'". Drives useIntroPlayback's own play/pause
  // switch directly off `region` -- the hook's rAF loop tears down via its
  // existing cleanup the moment region leaves 'intro', and re-arms (playing
  // becomes true again) the instant a backward scrub sets region back to
  // 'intro', ordered BEFORE/together-with the seekIntro call below so the
  // clock is playing again at (or holding) the newly-seeked position.
  // T6960: additionally gated on the photo being ready (above) — the card
  // holds its t=0 pose (treatment background + skeleton) until then.
  useEffect(() => {
    setPlaying(region === REGION.INTRO && introAssetsReady);
  }, [region, setPlaying, introAssetsReady]);

  // T6730 audit finding D (diagnostic only, no auto-correction): a forward
  // scrub across the boundary (onScrub's else branch below) hands off to
  // reels without ever pinning introTimeMs to introDurMs, so the composite
  // bar's Intro segment can be left showing a stale partial fill instead of a
  // completed one once region leaves 'intro' this way. Assumption: leaving
  // 'intro' always means introTimeMs === introDurMs.
  useEffect(() => {
    if (region === REGION.REELS && intro && introTimeMs < introDurMs) {
      console.warn(
        `[IntroStoryPlayer] region left 'intro' at introTimeMs=${Math.round(introTimeMs)}/${Math.round(introDurMs)} — the composite bar's Intro segment will show a stale partial fill instead of 100%`,
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [region]);

  // Single boundary comparison (design §5): globalMs < introDurMs -> the
  // intro (true arbitrary seek); else -> the matching reel + in-reel fraction.
  const onScrub = useCallback((globalMs) => {
    if (globalMs < introDurMs) {
      setRegion(REGION.INTRO);
      seekIntro(globalMs);
    } else {
      landInReels(reelIdxAndFractionFor(globalMs - introDurMs, durationsSec));
    }
  }, [introDurMs, seekIntro, durationsSec, landInReels]);

  __captureOnScrub?.(onScrub);

  // BLOCKING #2: live per-reel progress, reported by CollectionPlayer off the
  // SAME rAF tick useStoryPlayback already drives (no second rAF loop here) --
  // a lightweight derived mirror `{activeIndex, segmentProgress}` for
  // rendering the bar only. useStoryPlayback remains the one owner of real
  // reel playback position; this is receive-and-render, not re-derivation.
  const [reelProgress, setReelProgress] = useState({ activeIndex: 0, segmentProgress: 0 });
  const handleReelProgress = useCallback(({ activeIndex, segmentProgress }) => {
    setReelProgress({ activeIndex, segmentProgress });
  }, []);

  // Composite bar segments: intro (proportional to its own duration) + every
  // reel (also proportional, §7.3 Option B). The intro's fill tracks its own
  // clock; reel fills track `reelProgress` (fed by CollectionPlayer's
  // onProgress, above) while region==='reels' -- CollectionPlayer's OWN
  // internal bar stays suppressed (renderScrubber=false) so there is still
  // only ONE visible bar.
  const segments = useMemo(() => {
    const introSeg = intro
      ? [{ kind: 'intro', label: 'Intro', durationSec: introDurSec, fillPercent: introDurMs ? (introTimeMs / introDurMs) * 100 : 0 }]
      : [];
    const reelSegs = (reels || []).map((reel, i) => ({
      kind: 'reel',
      label: reel.name,
      durationSec: reel.duration,
      fillPercent: region !== REGION.REELS
        ? 0
        : i < reelProgress.activeIndex
          ? 100
          : i === reelProgress.activeIndex
            ? reelProgress.segmentProgress * 100
            : 0,
    }));
    return [...introSeg, ...reelSegs];
  }, [intro, introDurSec, introDurMs, introTimeMs, reels, region, reelProgress]);

  const handleScrubberScrub = useCallback(({ index, fraction }) => {
    if (intro && index === 0) {
      onScrub(fraction * introDurMs);
      return;
    }
    const reelIndex = intro ? index - 1 : index;
    const priorMs = durationsSec.slice(0, reelIndex).reduce((sum, d) => sum + d * 1000, 0);
    const reelMs = (durationsSec[reelIndex] || 0) * 1000;
    onScrub(introDurMs + priorMs + fraction * reelMs);
  }, [intro, introDurMs, durationsSec, onScrub]);

  return (
    <>
      {/* BLOCKING #1: CompositeScrubber's own root has no position/z-index, so
          as a bare sibling of the fixed/z-layered region renderers below it
          painted BEHIND both (invisible + unclickable in the real browser --
          jsdom unit tests never caught this, they don't do real layout/paint).
          Wrap it in its own fixed, correctly-layered container: Z.ALERT
          (z-[90]) sits above both Z.PLAYER (CollectionPlayer's panel, z-[70])
          and the intro's z-[85] default. The wrapper spans the full viewport
          so the bar can lay out at its natural top position; CompositeScrubber
          itself now owns the pointer-events split (T6730 audit finding E: its
          row is pointer-events-none, only its buttons opt back in), so
          clicks/taps on the bar's padding/gaps/divider fall through to the
          video/intro beneath instead of being silently swallowed. */}
      <div className={`fixed inset-0 ${Z.ALERT} pointer-events-none`}>
        <CompositeScrubber segments={segments} onScrub={handleScrubberScrub} />
      </div>
      {region === REGION.INTRO ? (
        <IntroPreRoll
          intro={intro}
          aspect={aspect}
          currentTimeMs={introTimeMs}
          positionClassName={introPositionClassName}
        />
      ) : (
        <CollectionPlayer
          reels={reels}
          renderScrubber={false}
          initialIndex={reelsLanding?.index ?? 0}
          initialSeekFraction={reelsLanding?.fraction ?? null}
          landingToken={landingToken}
          onProgress={handleReelProgress}
          {...collectionPlayerProps}
        />
      )}
    </>
  );
}

export default IntroStoryPlayer;
