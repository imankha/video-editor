// T5205 — browser MOTION preview. Plays the card's intro animation using the
// SHARED timing constants (INTRO_CARD_MOTION + STAGGER_ORDER) so the preview
// judges the SAME motion the render engine encodes (task scope B; the numbers
// live once in the contract, never copied here).
//
// T6710: `currentTimeMs`-driven and seekable (design §Part A / §4(i)) — every
// WAAPI `Animation` is built `pause()`d and scrubbed via `a.currentTime = ms`,
// the SAME code path for both forward playback (the composite's rAF clock
// ticking `currentTimeMs`) and an arbitrary backward scrub. End-of-intro is no
// longer this component's call — ownership moved to `useIntroPlayback`'s
// `onIntroEnded` in the composite, so `onDone`/the old `setTimeout` are gone.
//
// The motion vocabulary (T5210 / T5240 shared): photo push-in, per-line
// staggered fade-up, white-flash exit into the footage.

import { useCallback, useEffect, useRef, useState } from 'react';
import { RichText } from '../RichText';
import { selectCardComposition } from '../../utils/introCardComposition';
import { geometryFor, INTRO_CARD_MOTION, STAGGER_ORDER } from '../../utils/introCardGeometry';
import {
  treatmentBackgroundCss, photoStyleFor, scrimBackground,
  bandStyleFor, photoTintCss, photoVignetteCss, seamFadeCss,
} from './introCardVisual';
import { useCardPreviewElements } from './introCardPreviewElements';
import { resolveFraming } from './IntroCardPreview';

export function MotionPreview({ card, profile, aspect, boxWidth, boxHeight, currentTimeMs = 0 }) {
  const photoRef = useRef(null);
  const slotRefs = useRef({});
  const flashRef = useRef(null);
  // Live WAAPI Animation handles built by the effect below — a ref (not
  // state) because scrubbing them is an imperative side effect, not
  // something that should trigger a re-render.
  const animationsRef = useRef([]);
  // T6730 audit finding F (diagnostic only): the build effect below is
  // assumed to rerun only when `elements`/box identity genuinely changes
  // (see its own comment). If that assumption breaks — e.g. a future change
  // to `useCardPreviewElements` hands back a fresh array identity every
  // render during its settle window again — this effect would tear down and
  // rebuild every WAAPI animation on every render. Count executions per
  // mount and warn once if it churns well beyond the ~1-2 legitimate builds
  // (initial mount + one settle correction).
  const buildCountRef = useRef(0);
  const buildWarnedRef = useRef(false);
  const mountTimeRef = useRef(performance.now());
  // Track the latest currentTimeMs without adding it to the build effect's
  // deps — the build effect must NOT re-run on every clock tick (that would
  // tear down/rebuild the animations 60x/sec); it only reruns when the
  // underlying elements/box identity changes, then re-seeks to whatever the
  // clock currently is.
  const currentTimeMsRef = useRef(currentTimeMs);
  currentTimeMsRef.current = currentTimeMs;
  // Photo decode guard: don't reveal an undecoded frame mid-scrub (mirrors
  // CollectionPlayer.jsx's videoReady skeleton-until-loaded pattern).
  const [photoReady, setPhotoReady] = useState(false);
  // The visible <img> below nearly ALWAYS loads from cache: IntroStoryPlayer's
  // preloadIntroImage gate has already fetched+decoded this exact URL before the
  // card is shown (T6960), and a scrub-back into the intro remounts this
  // component against the same warmed cache with no new request at all. A
  // cache-complete <img> can be `complete` the instant it is attached, a state
  // the `load` event may never re-dispatch to React's just-attached listener —
  // so an onLoad-only gate leaves photoReady stuck false and the photo stuck
  // invisible (blank card) on both first play and scrub-back (T7030). Read
  // completeness directly instead of relying solely on the event.
  const imgNodeRef = useRef(null);

  const composition = selectCardComposition(card);
  const geo = geometryFor(composition, aspect);
  const framing = resolveFraming(card, profile);
  const hasPhoto = !!card?.image_key;
  const photoUrl = hasPhoto ? card?.previewUrl : null;
  const treatment = card?.treatment || 'gold';
  const { rectStyle, imgStyle } = photoStyleFor(geo.photo, framing, boxWidth, boxHeight);
  const scrim = scrimBackground(composition, hasPhoto, treatment);
  const tint = hasPhoto ? photoTintCss(treatment) : null;
  const vignette = hasPhoto ? photoVignetteCss(treatment) : null;
  const seam = hasPhoto ? seamFadeCss(geo.reflow, treatment) : null;
  const bandStyle = hasPhoto ? bandStyleFor(composition, treatment, boxWidth, boxHeight) : null;
  const elements = useCardPreviewElements(card, profile, composition, aspect, boxWidth, boxHeight);

  const durationSec = card?.duration || 4.0;

  // Ref callback: reveal the moment a cache-complete image is attached, without
  // waiting for a `load` event that may never fire for it (T7030). `complete`
  // alone is true for a BROKEN image too, so `naturalWidth > 0` is required —
  // an unpaintable image stays skeleton, matching the photoless-degrade
  // philosophy elsewhere.
  const attachImg = useCallback((node) => {
    imgNodeRef.current = node;
    if (node && node.complete && node.naturalWidth > 0) setPhotoReady(true);
  }, []);

  // Re-evaluate on every source change: the <img> node is REUSED across a src
  // swap (same component instance receiving a new card), so the ref callback
  // above won't re-fire. A new URL that isn't cached resets the gate to false
  // (wait for its load / decode); a cached one reveals immediately. This
  // replaces the old unconditional `setPhotoReady(false)` reset, which could
  // never observe a cache hit and so left preloaded photos stuck invisible.
  useEffect(() => {
    const node = imgNodeRef.current;
    setPhotoReady(!!(node && node.complete && node.naturalWidth > 0));
  }, [photoUrl]);

  // Build (or rebuild) every WAAPI Animation, PAUSED, keyed on `elements`
  // identity + box size — NOT a mount-once `[]`. This is the R1 fix: the
  // font-settle rebuild (introCardPreviewElements.js:277) can hand back a new
  // `elements` array identity up to ~45 frames after mount, remounting the
  // text slot DOM nodes and invalidating any Animation objects bound to the
  // old nodes. Re-running this effect on that identity change rebuilds fresh
  // Animations against the new nodes, then immediately re-seeks them to the
  // CURRENT clock — so a settle-triggered remount holds pose X instead of
  // snapping back to 0.
  useEffect(() => {
    const durationMs = durationSec * 1000;
    const m = INTRO_CARD_MOTION;
    const animations = [];

    // Photo push-in: scale from start->end zoom across the whole card.
    if (photoRef.current && hasPhoto) {
      animations.push(photoRef.current.animate(
        [
          { transform: `scale(${m.photoPushInZoomStart})` },
          { transform: `scale(${m.photoPushInZoomEnd})` },
        ],
        { duration: durationMs, easing: 'ease-out', fill: 'both' },
      ));
    }

    // Per-line staggered fade-up (opacity 0->1 + rise). Stagger keys off the
    // GEOMETRY slot (geoSlot), matching the renderer's stagger-by-slot — not the
    // rendered-fact count (which would differ when an earlier fact is blank).
    const risePx = m.textRiseFrac * boxHeight;
    elements.forEach((el) => {
      const node = slotRefs.current[el.slot];
      if (!node) return;
      const staggerIdx = Math.max(0, STAGGER_ORDER.indexOf(el.geoSlot));
      const delayMs = (m.textStaggerFirstSt + staggerIdx * m.textStaggerStep) * 1000;
      animations.push(node.animate(
        [
          { opacity: 0, transform: `translateY(${risePx}px)` },
          { opacity: 1, transform: 'translateY(0px)' },
        ],
        { duration: m.textFadeD * 1000, delay: delayMs, easing: 'ease-out', fill: 'both' },
      ));
    });

    // White-flash exit into the footage, at the very end.
    if (flashRef.current) {
      const flashDelay = Math.max(durationMs - m.flashOutD * 1000, 0);
      animations.push(flashRef.current.animate(
        [{ opacity: 0 }, { opacity: 1 }],
        { duration: m.flashOutD * 1000, delay: flashDelay, easing: 'ease-in', fill: 'both' },
      ));
    }

    // Pause() every animation immediately — playback is entirely driven by
    // seeking `currentTime`, both for the composite's forward rAF clock and
    // for an arbitrary scrub. `fill: 'both'` (already set above) means a
    // seek before/after an animation's own delay window still resolves to
    // its start/end pose, so staggered text needs no manual offset math.
    animations.forEach((a) => a.pause());
    animationsRef.current = animations;

    buildCountRef.current += 1;
    if (buildCountRef.current > 3 && !buildWarnedRef.current) {
      buildWarnedRef.current = true;
      console.warn(
        `[MotionPreview] animation set rebuilt ${buildCountRef.current} times in ${Math.round(performance.now() - mountTimeRef.current)}ms since mount — 'elements' identity is churning (useCardPreviewElements settle window regression?)`,
      );
    }

    // Re-seek to the CURRENT clock right after (re)building — this is what
    // makes a font-settle remount hold its pose instead of resetting to 0.
    animations.forEach((a) => { a.currentTime = currentTimeMsRef.current; });

    return () => {
      animations.forEach((a) => a.cancel());
    };
    // Deliberately keyed on elements/box identity, NOT currentTimeMs — see
    // the seek effect below for the per-tick scrub path.
  }, [elements, boxWidth, boxHeight, hasPhoto, durationSec]);

  // The actual seek: every currentTimeMs change scrubs the SAME animation
  // objects built above. One code path for forward playback and scrubbing.
  useEffect(() => {
    animationsRef.current.forEach((a) => { a.currentTime = currentTimeMs; });
  }, [currentTimeMs]);

  return (
    <div
      data-testid="motion-preview"
      className="absolute inset-0 overflow-hidden"
      style={{ width: `${boxWidth}px`, height: `${boxHeight}px`, background: treatmentBackgroundCss(treatment) }}
    >
      {photoUrl && (
        <div style={rectStyle}>
          {/* Skeleton until the photo has actually decoded — a scrub-to-mid
              must never reveal an un-decoded frame (mirrors
              CollectionPlayer.jsx's videoReady pattern). */}
          {!photoReady && (
            <div
              data-testid="motion-preview-photo-skeleton"
              aria-hidden="true"
              className="absolute inset-0 animate-pulse bg-white/5"
            />
          )}
          <div ref={photoRef} className="w-full h-full">
            <img
              ref={attachImg}
              src={photoUrl}
              alt=""
              // Lowercase on purpose: React 18 passes unknown lowercase
              // attributes through verbatim (camelCase fetchPriority is
              // dropped with a warning). Keeps the visible request at the
              // same elevated priority as preloadIntroImage's gate fetch.
              fetchpriority="high"
              draggable={false}
              className={`select-none pointer-events-none transition-opacity duration-150 ${photoReady ? 'opacity-100' : 'opacity-0'}`}
              style={imgStyle}
              onLoad={() => setPhotoReady(true)}
            />
          </div>
          {tint && <div className="absolute inset-0 pointer-events-none" style={{ background: tint }} />}
          {vignette && <div className="absolute inset-0 pointer-events-none" style={{ background: vignette }} />}
          {seam && <div className="absolute inset-0 pointer-events-none" style={{ background: seam }} />}
          {scrim && <div className="absolute inset-0 pointer-events-none" style={{ background: scrim }} />}
        </div>
      )}
      {bandStyle && <div style={bandStyle} />}

      {elements.map((el) => (
        <div
          key={el.slot}
          ref={(node) => { slotRefs.current[el.slot] = node; }}
          data-testid={`motion-slot-${el.slot}`}
          className="absolute inset-0 pointer-events-none"
          style={{ opacity: 0 }}
        >
          <RichText spec={el.spec} boxWidth={boxWidth} boxHeight={boxHeight} />
        </div>
      ))}

      <div ref={flashRef} className="absolute inset-0 pointer-events-none" style={{ background: '#ffffff', opacity: 0 }} />
    </div>
  );
}

export default MotionPreview;
