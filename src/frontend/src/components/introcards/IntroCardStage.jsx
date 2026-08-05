// T5205 — the editor STAGE (presentational). Shows the card at a chosen aspect
// (9:16 / 16:9 toggle), lets the user drag the photo to reframe and zoom it, and
// names the current composition quietly on the stage. Drag/zoom are transient
// here; the container commits each ONCE on release.
//
// SLOT GEOMETRY + MOTION are T5210's contract: the text slots draw only once the
// composition-geometry mirror is imported (passed through IntroCardPreview's
// `geometry`), and the motion-preview button stays disabled until the shared
// timing constants land. This stage deliberately hard-codes NEITHER.

import { useRef } from 'react';
import { Play } from 'lucide-react';
import { IntroCardPreview, resolveFraming } from './IntroCardPreview';
import { selectCardComposition } from '../../utils/introCardComposition';
import { ASPECT_OPTIONS } from './introCardEditorConstants';

const STAGE_MAX_H = 420;
const STAGE_MAX_W = 480;

function boxFor(aspect) {
  // Fit the aspect box within the max envelope (whichever constraint binds).
  const byHeight = { h: STAGE_MAX_H, w: (STAGE_MAX_H * aspect.w) / aspect.h };
  if (byHeight.w <= STAGE_MAX_W) return { w: Math.round(byHeight.w), h: STAGE_MAX_H };
  return { w: STAGE_MAX_W, h: Math.round((STAGE_MAX_W * aspect.h) / aspect.w) };
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
  onZoomInput,
  onZoomRelease,
}) {
  const aspect = ASPECT_OPTIONS.find((a) => a.key === aspectRatio) || ASPECT_OPTIONS[0];
  const box = boxFor(aspect);

  const persisted = resolveFraming(card, profile);
  const focalX = dragFocal ? dragFocal.x : persisted.focalX;
  const focalY = dragFocal ? dragFocal.y : persisted.focalY;
  const zoom = zoomDraft != null ? zoomDraft : persisted.zoom;

  // Feed the preview an effective card carrying the live (possibly transient)
  // framing so the photo tracks the drag/zoom without persisting mid-gesture.
  const effectiveCard = { ...card, focal_x: focalX, focal_y: focalY, zoom };
  const composition = selectCardComposition(effectiveCard);
  const hasPhoto = !!card.image_key;

  const dragRef = useRef(null);

  const handlePointerDown = (e) => {
    if (!hasPhoto) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startFocalX: focalX,
      startFocalY: focalY,
      last: { x: focalX, y: focalY },
    };
  };

  const handlePointerMove = (e) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    // Dragging the photo right reveals more of its LEFT side -> focal moves left.
    const next = {
      x: clamp01(drag.startFocalX - dx / box.w),
      y: clamp01(drag.startFocalY - dy / box.h),
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
              className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                active ? 'bg-blue-600 text-white' : 'text-gray-300 hover:text-white'
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      <div className="relative" style={{ width: `${box.w}px`, height: `${box.h}px` }}>
        <IntroCardPreview card={effectiveCard} profile={profile} boxWidth={box.w} boxHeight={box.h} />

        {/* Photo drag surface (only with a photo) */}
        {hasPhoto && (
          <div
            data-testid="intro-photo-drag"
            role="application"
            aria-label="Drag to reposition the photo"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            className="absolute inset-0 cursor-move touch-none"
          />
        )}

        {/* Composition name — quiet, legible not magic. */}
        <span
          className="absolute bottom-1.5 left-1.5 px-1.5 py-0.5 rounded bg-black/60 backdrop-blur-sm text-[11px] text-gray-200 pointer-events-none"
          data-testid="composition-label"
        >
          {composition}
        </span>
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
            onKeyUp={(e) => onZoomRelease(parseFloat(e.currentTarget.value))}
            className="flex-1"
          />
        </label>
      )}

      {/* Motion preview — pending T5210's shared timing constants. */}
      <button
        type="button"
        disabled
        title="Motion preview uses the card animation timings (arriving with the render engine)"
        className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-gray-800 border border-gray-700 text-gray-500 cursor-not-allowed"
      >
        <Play size={14} /> Motion preview
      </button>
    </div>
  );
}

export default IntroCardStage;
