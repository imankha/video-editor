// T5205 — the editor STAGE (presentational). Shows the card at a chosen aspect
// (9:16 / 16:9 toggle), lets the user drag the photo to reframe and zoom it,
// and play the motion preview. The layout is NOT named on the stage (T6570:
// the user does not want the layout named); the causal signal lives as the
// rail's facts caption. Drag/zoom are transient here; the container commits
// each ONCE on release.
//
// T6640: per-slot text SELECTION is gone from the stage — typography is
// template-owned (decision 12), so there is nothing left to select a slot FOR
// (the styling editor it used to open no longer exists on the card rail).
//
// Slot geometry, treatment colours and motion timing all come from T5210's shared
// contract (via IntroCardPreview / introCardGeometry / MotionPreview) — this stage
// hard-codes none of them.

import { useEffect, useRef, useState } from 'react';
import { Play, Square } from 'lucide-react';
import { IntroCardPreview, resolveFraming } from './IntroCardPreview';
import { MotionPreview } from './MotionPreview';
import { useMotionPreviewAutoplay } from './useMotionPreviewAutoplay';
import { selectCardComposition } from '../../utils/introCardComposition';
import { geometryFor } from '../../utils/introCardGeometry';
import { ASPECT_OPTIONS } from './introCardEditorConstants';

// Desktop caps. The card is the thing being designed (T6580), so it fills the
// available stage column instead of sitting small in a large modal.
const STAGE_MAX_H = 640;
const STAGE_MAX_W = 600;
// Stacked (mobile) layout: keep the card at the T6540 height so a bigger card
// never pushes the rail controls below the fold — the density gate is a HARD
// constraint (T6540-critique). The card grows on desktop, where the stage and
// rail are side by side and the rail scrolls independently.
const STACKED_MAX_H = 420;
// Vertical chrome reserved inside the stage column (aspect toggle + motion
// preview button + the column's gaps) so a full-height card never clips them.
const STAGE_CHROME_H = 104;

// The stage box is capped by BOTH a max height and the width actually available
// (measured), so a 16:9 card (which is wide) never overflows a 375px phone — the
// old fixed 480px width scrolled the whole editor sideways on mobile.
function boxFor(aspect, maxW, maxH) {
  const byHeight = { h: maxH, w: (maxH * aspect.w) / aspect.h };
  if (byHeight.w <= maxW) return { w: Math.round(byHeight.w), h: maxH };
  return { w: maxW, h: Math.round((maxW * aspect.h) / aspect.w) };
}

const clamp01 = (v) => Math.min(1, Math.max(0, v));

export function IntroCardStage({
  card,
  profile,
  aspectRatio,
  onAspectRatioChange,
  dragFocal,
  zoomDraft,
  onPhotoDragMove,
  onPhotoDragEnd,
}) {
  const aspectOpt = ASPECT_OPTIONS.find((a) => a.key === aspectRatio) || ASPECT_OPTIONS[0];
  const aspect = aspectOpt.key; // === CARD_ASPECTS key ('9:16' / '16:9')

  // Measure the space the stage column actually gives us (BOTH axes) and size the
  // card to it. On desktop the column is height-constrained by the flex row, so
  // its measured height is a stable target (the card is a child and never drives
  // the column height — no feedback loop); on a stacked layout the column height
  // is content-driven, so we cap by the fixed stacked height instead of the
  // (circular) measurement.
  const wrapRef = useRef(null);
  const [avail, setAvail] = useState({ w: STAGE_MAX_W, h: STAGE_MAX_H });
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect;
      if (cr?.width) setAvail({ w: cr.width, h: cr.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const isWide = typeof window !== 'undefined'
    && window.matchMedia('(min-width: 1024px)').matches;
  const maxW = Math.min(STAGE_MAX_W, avail.w);
  const maxH = isWide
    ? Math.min(STAGE_MAX_H, Math.max(STACKED_MAX_H, avail.h - STAGE_CHROME_H))
    : STACKED_MAX_H;
  const box = boxFor(aspectOpt, maxW, maxH);

  const persisted = resolveFraming(card, profile);
  const focalX = dragFocal ? dragFocal.x : persisted.focalX;
  const focalY = dragFocal ? dragFocal.y : persisted.focalY;
  const zoom = zoomDraft != null ? zoomDraft : persisted.zoom;

  const effectiveCard = { ...card, focal_x: focalX, focal_y: focalY, zoom };
  const composition = selectCardComposition(effectiveCard);
  const hasPhoto = !!card.image_key;
  const geo = geometryFor(composition, aspect);
  const photoRect = geo.photo;

  const [playing, setPlaying] = useState(false);
  const dragRef = useRef(null);
  // T6710: MotionPreview no longer self-completes via setTimeout(onDone) --
  // it is purely currentTimeMs-driven/seekable now. The Play/Stop button
  // still wants "play once, then stop", so drive it with the shared
  // fallback-autoplay clock (also used by IntroPreRoll/IntroCardCarousel).
  const stageDurationMs = (effectiveCard?.duration || 4.0) * 1000;
  const previewTimeMs = useMotionPreviewAutoplay(stageDurationMs, {
    active: playing,
    onDone: () => setPlaying(false),
  });

  const photoRectPx = {
    left: photoRect.x * box.w,
    top: photoRect.y * box.h,
    width: photoRect.w * box.w,
    height: photoRect.h * box.h,
  };

  const handlePointerDown = (e) => {
    if (!hasPhoto) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, startFocalX: focalX, startFocalY: focalY, last: { x: focalX, y: focalY } };
  };

  const handlePointerMove = (e) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    // Pan relative to the VISIBLE photo rect; dragging right reveals the LEFT.
    const next = {
      x: clamp01(drag.startFocalX - dx / photoRectPx.width),
      y: clamp01(drag.startFocalY - dy / photoRectPx.height),
    };
    drag.last = next;
    onPhotoDragMove(next);
  };

  const handlePointerUp = (e) => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    onPhotoDragEnd(drag.last);
  };

  return (
    <div ref={wrapRef} className="w-full lg:flex-1 lg:min-w-0 flex flex-col items-center gap-3">
      {/* Aspect preview toggle — one framing must read correctly in BOTH. */}
      <div className="flex items-center gap-1 bg-gray-800 border border-gray-700 rounded p-0.5" role="group" aria-label="Aspect preview">
        {ASPECT_OPTIONS.map((opt) => {
          const active = opt.key === aspectRatio;
          return (
            <button
              key={opt.key}
              type="button"
              aria-pressed={active}
              onClick={() => onAspectRatioChange(opt.key)}
              className={`px-4 py-1.5 rounded text-sm font-medium transition-colors coarse-pointer:min-h-[44px] ${active ? 'bg-blue-600 text-white' : 'text-gray-300 hover:text-white'}`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      <div className="relative" style={{ width: `${box.w}px`, height: `${box.h}px` }}>
        <IntroCardPreview card={effectiveCard} profile={profile} boxWidth={box.w} boxHeight={box.h} aspect={aspect} />

        {/* Photo drag surface — bounded to the photo rect (recruiting insets it). */}
        {hasPhoto && !playing && (
          <div
            data-testid="intro-photo-drag"
            role="application"
            aria-label="Drag to reposition the photo"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            className="absolute cursor-move touch-none"
            style={{ left: `${photoRectPx.left}px`, top: `${photoRectPx.top}px`, width: `${photoRectPx.width}px`, height: `${photoRectPx.height}px` }}
          />
        )}

        {/* No composition NAME on the stage (T6570): the user does not want the
            layout named. The causal signal — that ticking facts re-lays-out the
            card — is carried by the rail's "the layout adapts to the facts you
            show" caption WITHOUT naming a layout. The preview root still exposes
            data-composition for tests. */}

        {playing && (
          <MotionPreview
            card={effectiveCard}
            profile={profile}
            aspect={aspect}
            boxWidth={box.w}
            boxHeight={box.h}
            currentTimeMs={previewTimeMs}
          />
        )}
      </div>

      {/* Motion preview — animates from the shared timing constants. Zoom moved
          to the rail's Photo group (all indirect photo controls live together;
          direct-manipulation drag stays here on the image). */}
      <button
        type="button"
        onClick={() => setPlaying((p) => !p)}
        data-testid="motion-preview-button"
        className="flex items-center gap-1.5 px-4 py-2 rounded text-sm font-medium bg-gray-800 border border-gray-700 text-gray-200 hover:bg-gray-700 coarse-pointer:min-h-[44px]"
      >
        {playing ? <><Square size={16} /> Stop</> : <><Play size={16} /> Motion preview</>}
      </button>
    </div>
  );
}

export default IntroCardStage;
