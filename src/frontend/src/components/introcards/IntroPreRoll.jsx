// T5220 Scope B — the DOM pre-roll wrapper shown before playback on the public
// React surfaces (SharedVideoOverlay, SharedCollectionView), mirroring
// BrandedEndCard's mount-gated pattern in reverse: BrandedEndCard shows AFTER
// playback ends, this shows BEFORE it starts. Reuses `MotionPreview` verbatim
// (design §5) -- preview == playback == export by construction, no second
// animation path for the same card.
//
// T6710: MotionPreview is now currentTime-driven/seekable and no longer runs
// its own auto-continue timer (that ownership moved to useIntroPlayback, the
// owner in-app composite's clock -- design §4(i)). IntroStoryPlayer (the
// owner in-app path) passes a driven `currentTimeMs` straight through and
// owns `onDone`-equivalent handling itself (via onIntroEnded), so it never
// passes `onDone` here.
//
// SharedVideoOverlay and SharedCollectionView are explicitly OUT of this
// task's scope (design §1.1/§1.3 -- they keep their own separate swap
// ternary) but BOTH still call this component the old way: no
// `currentTimeMs`, an `onDone` they rely on to flip `introShowing` off. To
// keep them working unmodified, THIS wrapper (not MotionPreview) now owns a
// small self-contained fallback clock -- active only when the caller passes
// `onDone` and does not drive `currentTimeMs` itself -- that ticks a local
// `currentTimeMs` via rAF up to the card's duration and then fires `onDone`
// once. The owner in-app path never sets `onDone`, so it always takes the
// externally-driven branch below; the legacy callers keep their exact old
// behavior (auto-plays once, then advances) without changing a line in
// either of their files.
//
// The backend payload (design §5.4) splits what the editor keeps on ONE
// object into `{card, previewUrl, field_values, profile}` -- `previewUrl`
// separate from `card` (the card row has no live R2 URL of its own), and
// `field_values` (the athlete's facts: full_name/position/class/team) separate
// from `profile` (framing-only: focal_x/focal_y/zoom, always {} today -- there
// is no backend `profiles` framing column to cross a share boundary with).
// MotionPreview -- unmodified, the SAME component the editor uses -- reads the
// photo off `card.previewUrl` and the facts off `profile.full_name`/
// `profile[shownField]` (see `introCardPreviewElements.js`). This wrapper's
// entire job is reassembling those two split shapes back into the single
// `card`/`profile` shape MotionPreview has always expected.

import { useEffect, useRef, useState } from 'react';
import { MotionPreview } from './MotionPreview';
import { useMotionPreviewAutoplay } from './useMotionPreviewAutoplay';
import { CARD_ASPECTS } from '../../utils/introCardGeometry';

const MAX_W = 480;
const MAX_H = 854; // 9:16 at MAX_W

function boxFor(aspect, maxW, maxH) {
  const [rw, rh] = aspect.split(':').map(Number);
  const byHeight = { h: maxH, w: (maxH * rw) / rh };
  if (byHeight.w <= maxW) return { w: Math.round(byHeight.w), h: maxH };
  return { w: maxW, h: Math.round((maxW * rh) / rw) };
}

export function IntroPreRoll({
  intro,
  aspect = CARD_ASPECTS.portrait,
  onDone,
  // T6710: driven clock from the owner in-app composite (useIntroPlayback,
  // via IntroStoryPlayer). Omitted -> this wrapper drives itself via
  // useMotionPreviewAutoplay below (the SharedVideoOverlay/SharedCollectionView path).
  currentTimeMs,
  // Default anchors inside a relative player container (SharedVideoOverlay).
  // Fullscreen fixed players (SharedCollectionView, z-[90] BrandedEndCard)
  // must pass a fixed, appropriately-layered override -- mirrors
  // BrandedEndCard's positionClassName contract exactly.
  positionClassName = 'absolute inset-0 z-30',
}) {
  const wrapRef = useRef(null);
  const [avail, setAvail] = useState({ w: MAX_W, h: MAX_H });
  const isExternallyDriven = currentTimeMs != null;
  const durationMs = (intro?.card?.duration || 4.0) * 1000;
  const fallbackMs = useMotionPreviewAutoplay(durationMs, { active: !isExternallyDriven && !!intro, onDone });

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect;
      if (cr?.width && cr?.height) setAvail({ w: cr.width, h: cr.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (!intro) return null;

  const box = boxFor(aspect, Math.min(MAX_W, avail.w), Math.min(MAX_H, avail.h));
  // Reassemble the split payload into the single card/profile shape
  // MotionPreview expects (see module docstring).
  const card = { ...intro.card, previewUrl: intro.previewUrl };
  const profile = { ...intro.profile, ...intro.field_values };

  return (
    <div
      ref={wrapRef}
      className={`${positionClassName} flex items-center justify-center bg-black`}
    >
      <div className="relative" style={{ width: `${box.w}px`, height: `${box.h}px` }}>
        <MotionPreview
          card={card}
          profile={profile}
          aspect={aspect}
          boxWidth={box.w}
          boxHeight={box.h}
          currentTimeMs={isExternallyDriven ? currentTimeMs : fallbackMs}
        />
      </div>
    </div>
  );
}

export default IntroPreRoll;
