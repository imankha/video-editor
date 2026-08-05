// T5205 — the editor STAGE (presentational). Shows the card at a chosen aspect
// (9:16 / 16:9 toggle), lets the user drag the photo to reframe and zoom it,
// select a text slot by clicking it, and play the motion preview. Names the
// current composition quietly on the stage. Drag/zoom are transient here; the
// container commits each ONCE on release.
//
// Slot geometry, treatment colours and motion timing all come from T5210's shared
// contract (via IntroCardPreview / introCardGeometry / MotionPreview) — this stage
// hard-codes none of them.

import { useRef, useState } from 'react';
import { Play, Square } from 'lucide-react';
import { IntroCardPreview, resolveFraming } from './IntroCardPreview';
import { MotionPreview } from './MotionPreview';
import { selectCardComposition } from '../../utils/introCardComposition';
import { geometryFor } from '../../utils/introCardGeometry';
import { buildPreviewElements } from './introCardPreviewElements';
import { ASPECT_OPTIONS } from './introCardEditorConstants';

const STAGE_MAX_H = 420;
const STAGE_MAX_W = 480;

function boxFor(aspect) {
  const byHeight = { h: STAGE_MAX_H, w: (STAGE_MAX_H * aspect.w) / aspect.h };
  if (byHeight.w <= STAGE_MAX_W) return { w: Math.round(byHeight.w), h: STAGE_MAX_H };
  return { w: STAGE_MAX_W, h: Math.round((STAGE_MAX_W * aspect.h) / aspect.w) };
}

const clamp01 = (v) => Math.min(1, Math.max(0, v));

/** A clickable hotspot rect for a rendered slot, from its (contract) layout spec. */
function slotBox(spec, boxW, boxH) {
  const width = spec.maxWidth * boxW;
  const height = Math.max(spec.size * boxH * 1.3, 22);
  const xPx = spec.position.x * boxW;
  const top = spec.position.y * boxH;
  let left = xPx;
  if (spec.align === 'center') left = xPx - width / 2;
  else if (spec.align === 'right') left = xPx - width;
  return { left, top, width, height };
}

export function IntroCardStage({
  card,
  profile,
  aspectRatio,
  onAspectRatioChange,
  dragFocal,
  zoomDraft,
  onPhotoDragMove,
  onPhotoDragEnd,
  onZoomInput,
  onZoomRelease,
  selectedSlot,
  onSelectSlot,
}) {
  const aspectOpt = ASPECT_OPTIONS.find((a) => a.key === aspectRatio) || ASPECT_OPTIONS[0];
  const aspect = aspectOpt.key; // === CARD_ASPECTS key ('9:16' / '16:9')
  const box = boxFor(aspectOpt);

  const persisted = resolveFraming(card, profile);
  const focalX = dragFocal ? dragFocal.x : persisted.focalX;
  const focalY = dragFocal ? dragFocal.y : persisted.focalY;
  const zoom = zoomDraft != null ? zoomDraft : persisted.zoom;

  const effectiveCard = { ...card, focal_x: focalX, focal_y: focalY, zoom };
  const composition = selectCardComposition(effectiveCard);
  const hasPhoto = !!card.image_key;
  const geo = geometryFor(composition, aspect);
  const photoRect = geo.photo;

  // Rendered slots (title + shown/filled facts) -> stage hotspots for selection.
  const elements = buildPreviewElements(effectiveCard, profile, composition, aspect);

  const [playing, setPlaying] = useState(false);
  const dragRef = useRef(null);

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
    <div className="flex flex-col items-center gap-3">
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
              className={`px-3 py-1 rounded text-xs font-medium transition-colors ${active ? 'bg-blue-600 text-white' : 'text-gray-300 hover:text-white'}`}
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

        {/* Slot-select hotspots ABOVE the drag surface: clicking text selects its
            slot; clicking the photo elsewhere drags it. */}
        {!playing && elements.map(({ slot, spec }) => {
          const b = slotBox(spec, box.w, box.h);
          const selected = slot === selectedSlot;
          return (
            <button
              key={slot}
              type="button"
              aria-label={`Select ${slot}`}
              onClick={() => onSelectSlot(slot)}
              className={`absolute rounded ${selected ? 'ring-2 ring-blue-400' : 'hover:ring-1 hover:ring-white/40'}`}
              style={{ left: `${b.left}px`, top: `${b.top}px`, width: `${b.width}px`, height: `${b.height}px`, background: 'transparent' }}
            />
          );
        })}

        {/* Composition name — quiet, legible not magic. */}
        <span className="absolute bottom-1.5 left-1.5 px-1.5 py-0.5 rounded bg-black/60 backdrop-blur-sm text-[11px] text-gray-200 pointer-events-none" data-testid="composition-label">
          {composition}
        </span>

        {playing && (
          <MotionPreview
            card={effectiveCard}
            profile={profile}
            aspect={aspect}
            boxWidth={box.w}
            boxHeight={box.h}
            onDone={() => setPlaying(false)}
          />
        )}
      </div>

      {/* Zoom — commits on release, not per input event. */}
      {hasPhoto && (
        <label className="flex items-center gap-2 w-full max-w-xs text-xs text-gray-400">
          <span className="uppercase tracking-wide">Zoom</span>
          <input
            type="range"
            aria-label="Zoom"
            min={1}
            max={4}
            step={0.05}
            value={zoom}
            onChange={(e) => onZoomInput(parseFloat(e.target.value))}
            onPointerUp={(e) => onZoomRelease(parseFloat(e.currentTarget.value))}
            onBlur={(e) => onZoomRelease(parseFloat(e.currentTarget.value))}
            className="flex-1"
          />
        </label>
      )}

      {/* Motion preview — animates from the shared timing constants. */}
      <button
        type="button"
        onClick={() => setPlaying((p) => !p)}
        data-testid="motion-preview-button"
        className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-gray-800 border border-gray-700 text-gray-200 hover:bg-gray-700"
      >
        {playing ? <><Square size={14} /> Stop</> : <><Play size={14} /> Motion preview</>}
      </button>
    </div>
  );
}

export default IntroCardStage;
