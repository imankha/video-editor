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

import { useCallback, useMemo, useState } from 'react';
import { useIntroPlayback } from './useIntroPlayback';
import { IntroPreRoll } from './IntroPreRoll';
import { CollectionPlayer } from '../collections/CollectionPlayer';
import { CompositeScrubber } from './CompositeScrubber';

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
  introPositionClassName = 'fixed inset-0 z-[85]',
  ...collectionPlayerProps
}) {
  const [region, setRegion] = useState(intro ? REGION.INTRO : REGION.REELS);
  // Where a boundary-crossing scrub should land inside the reels region —
  // consumed once by CollectionPlayer's own useStoryPlayback via goTo, then
  // cleared. null means "no pending cross-boundary landing" (mount default /
  // ordinary in-region playback).
  const [reelsLanding, setReelsLanding] = useState(null);

  const introDurSec = intro ? (intro.card?.duration || 4.0) : 0;
  const introDurMs = introDurSec * 1000;
  const durationsSec = useMemo(() => reelDurationsSec(reels), [reels]);

  // Forward auto-continue: onIntroEnded -> region='reels', landing at reel 0.
  // Guarded against double-fire (R2, e.g. a fast forward-scrub past the intro
  // also reaching the clock's end) by ignoring the callback once region has
  // already left 'intro' — mirrors useStoryPlayback's pendingSeekRef
  // cancel-on-transition pattern.
  const handleIntroEnded = useCallback(() => {
    setRegion((current) => {
      if (current !== REGION.INTRO) return current;
      setReelsLanding({ index: 0, fraction: 0 });
      return REGION.REELS;
    });
  }, []);

  const { introTimeMs, seekIntro } = useIntroPlayback(introDurSec, { onIntroEnded: handleIntroEnded });

  // Single boundary comparison (design §5): globalMs < introDurMs -> the
  // intro (true arbitrary seek); else -> the matching reel + in-reel fraction.
  const onScrub = useCallback((globalMs) => {
    if (globalMs < introDurMs) {
      setRegion(REGION.INTRO);
      seekIntro(globalMs);
    } else {
      const landing = reelIdxAndFractionFor(globalMs - introDurMs, durationsSec);
      setReelsLanding(landing);
      setRegion(REGION.REELS);
    }
  }, [introDurMs, seekIntro, durationsSec]);

  __captureOnScrub?.(onScrub);

  // Composite bar segments: intro (proportional to its own duration) + every
  // reel (also proportional, §7.3 Option B). The intro's fill tracks its own
  // clock; reel fills stay at 0 here — CollectionPlayer's OWN bar (suppressed
  // here via renderScrubber=false) is what tracks live per-reel progress
  // while region==='reels'; this composite bar's job is the cross-boundary
  // scrub target, not a second live-progress source for reels.
  const segments = useMemo(() => {
    const introSeg = intro
      ? [{ kind: 'intro', label: 'Intro', durationSec: introDurSec, fillPercent: introDurMs ? (introTimeMs / introDurMs) * 100 : 0 }]
      : [];
    const reelSegs = (reels || []).map((reel) => ({
      kind: 'reel',
      label: reel.name,
      durationSec: reel.duration,
      fillPercent: 0,
    }));
    return [...introSeg, ...reelSegs];
  }, [intro, introDurSec, introDurMs, introTimeMs, reels]);

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
      <CompositeScrubber segments={segments} onScrub={handleScrubberScrub} />
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
          {...collectionPlayerProps}
        />
      )}
    </>
  );
}

export default IntroStoryPlayer;
