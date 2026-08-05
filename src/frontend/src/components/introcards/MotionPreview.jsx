// T5205 — browser MOTION preview. Plays the card's intro animation using the
// SHARED timing constants (INTRO_CARD_MOTION + STAGGER_ORDER) so the preview
// judges the SAME motion the render engine encodes (task scope B; the numbers
// live once in the contract, never copied here). Overlays the stage during
// playback and calls onDone when finished.
//
// The motion vocabulary (T5210 / T5240 shared): photo push-in, per-line
// staggered fade-up, white-flash exit into the footage.

import { useEffect, useRef } from 'react';
import { RichText } from '../RichText';
import { selectCardComposition } from '../../utils/introCardComposition';
import { geometryFor, INTRO_CARD_MOTION, STAGGER_ORDER } from '../../utils/introCardGeometry';
import { treatmentBackgroundCss, photoStyleFor, scrimBackground } from './introCardVisual';
import { buildPreviewElements } from './introCardPreviewElements';
import { resolveFraming } from './IntroCardPreview';

export function MotionPreview({ card, profile, aspect, boxWidth, boxHeight, onDone }) {
  const photoRef = useRef(null);
  const slotRefs = useRef({});
  const flashRef = useRef(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  const composition = selectCardComposition(card);
  const geo = geometryFor(composition, aspect);
  const framing = resolveFraming(card, profile);
  const hasPhoto = !!card?.image_key;
  const photoUrl = hasPhoto ? card?.previewUrl : null;
  const { rectStyle, imgStyle } = photoStyleFor(geo.photo, framing, boxWidth, boxHeight);
  const scrim = scrimBackground(composition, hasPhoto);
  const elements = buildPreviewElements(card, profile, composition, aspect);

  const durationSec = card?.duration || 4.0;

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

    // Per-line staggered fade-up (opacity 0->1 + rise), keyed by STAGGER_ORDER.
    const risePx = m.textRiseFrac * boxHeight;
    elements.forEach((el, i) => {
      const node = slotRefs.current[el.slot];
      if (!node) return;
      const ordinal = el.kind === 'title' ? 'title' : `fact${factIndex(elements, i)}`;
      const staggerIdx = Math.max(0, STAGGER_ORDER.indexOf(ordinal));
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

    const timer = setTimeout(() => doneRef.current && doneRef.current(), durationMs + 60);
    return () => {
      clearTimeout(timer);
      animations.forEach((a) => a.cancel());
    };
    // Play once per mount; deps intentionally minimal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      data-testid="motion-preview"
      className="absolute inset-0 overflow-hidden"
      style={{ width: `${boxWidth}px`, height: `${boxHeight}px`, background: treatmentBackgroundCss(card?.treatment || 'gold') }}
    >
      {photoUrl && (
        <div style={rectStyle}>
          <div ref={photoRef} className="w-full h-full">
            <img src={photoUrl} alt="" draggable={false} className="select-none pointer-events-none" style={imgStyle} />
          </div>
          {scrim && <div className="absolute inset-0 pointer-events-none" style={{ background: scrim }} />}
        </div>
      )}

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

// The ordinal index (1-based) of a fact element among the fact elements, matching
// the renderer's fact{N} keying (elements are emitted title-first then facts).
function factIndex(elements, indexInList) {
  let n = 0;
  for (let k = 0; k <= indexInList; k += 1) {
    if (elements[k].kind === 'fact') n += 1;
  }
  return n;
}

export default MotionPreview;
