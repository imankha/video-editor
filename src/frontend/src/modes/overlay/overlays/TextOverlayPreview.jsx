import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import useVideoDisplayRect, { round3 } from '../../../hooks/useVideoDisplayRect';
import RichText from '../../../components/RichText';

/**
 * TextOverlayPreview -- live "what you see is what renders" preview for
 * Overlay text (T5225 design §4.3; T6630 round 4 model reframe). Positions
 * the SAME <RichText> component (T5180) the card editor will use, absolutely
 * over the displayed video area via the shared `useVideoDisplayRect`
 * transform (the same SSOT every overlay -- crop, highlight, player
 * detection -- already uses).
 *
 * MODEL (T6630 round 4): `textOverlays` is a list of REGIONS -- time spans
 * that each CONTAIN N elements, all rendering SIMULTANEOUSLY during the
 * region's window (user direction: "a text region can have multiple text
 * elements"). A region is ACTIVE when its `[startTime, endTime)` half-open
 * range contains `currentTime` (design O6) -- OR when it is the currently
 * SELECTED region (so editing is visible even while the playhead sits
 * outside the range). Every element of an active region renders, except one
 * individually disabled (T6620's per-element eye).
 *
 * T6620: a DISABLED element (`enabled === false`) is hidden UNCONDITIONALLY --
 * checked BEFORE the selected-region short-circuit. Previously a selected
 * block rendered regardless of `enabled`, so clicking the eye on the element
 * you were editing never hid its text ("the eye button doesn't turn off the
 * text"). The export already honours it (`_rasterize_text_layers` filters
 * `enabled` after `_flatten_text_regions`), so this closes the preview/export
 * gap. `enabled === false` (not `!enabled`) is deliberate: a DB-loaded
 * element with `enabled === undefined` (never toggled) must still SHOW.
 *
 * T6720: the currently-SELECTED element gets a SPATIAL DRAG affordance -- a
 * grab frame over its rendered text that repositions `spec.position` (the same
 * fractional anchor the 9 align/position presets write, and the same field
 * text_render.py burns in, so preview == export by construction). The drag
 * reuses the established HighlightOverlay idiom: transient state in refs (first
 * pointermove honoured with zero re-render lag, T5380), one unified pointer path
 * (mouse + touch) with setPointerCapture, a non-passive touchmove blocker, a
 * TAP_SLOP click-vs-drag gate, LOCAL-only moves per pointermove and exactly ONE
 * surgical write on pointerup (gesture-based persistence, mirrors T6610's body
 * drag). Only the selected element is draggable; every other element and the
 * bare video stay `pointer-events-none` (video tap-nav passes through).
 */

// A pointer down->up moving less than this (screen px) is a TAP, not a drag --
// it selects/does nothing rather than committing a position. Squared to skip a
// sqrt in the hot move handler. Mirrors HighlightOverlay's TAP_SLOP.
const TAP_SLOP = 6;
const TAP_SLOP_SQ = TAP_SLOP * TAP_SLOP;

// Grab-frame padding (screen px) so a thin caption is still easy to grab and the
// affordance reads as a handle around the text, not exactly on the ink edge.
const GRAB_PAD_PX = 6;

// Non-passive touchmove blocker used ONLY during an active drag. On touch,
// preventDefault on pointerdown does not stop the page panning, so we suppress
// the browser's default touch scroll at the document level while a drag is in
// flight, then remove it on pointer up. Module-level so add/remove share one ref.
const preventDefaultTouch = (e) => { e.preventDefault(); };

/** Clamp v into the range [a,b], tolerant of a>b (box wider/taller than frame). */
function clampRange(v, a, b) {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return Math.max(lo, Math.min(v, hi));
}

/**
 * Clamp a desired anchor so the element's rendered bounding box stays on-frame.
 *
 * `box` describes the rendered text box RELATIVE to the anchor, all in frame
 * fractions (measured live from the DOM, so it reflects the actual wrapped ink
 * -- short vs long strings clamp differently, per the task requirement, not a
 * fixed maxWidth assumption): `offLeftF`/`offTopF` = box top-left minus the
 * anchor; `widthF`/`heightF` = box size. The box translates rigidly with the
 * anchor (align/size/text are fixed during a drag), so these are constants for
 * the whole gesture. When the box is WIDER/TALLER than the frame the clamp keeps
 * it covering the frame (neither edge pulled inward) rather than snapping it.
 *
 * Exported for unit testing (jsdom has no real layout, so the drag mechanics
 * themselves need the real-browser qa spec -- this pins the pure math).
 */
export function clampAnchorToFrame(anchorX, anchorY, box) {
  const boxLeft = clampRange(anchorX + box.offLeftF, 0, 1 - box.widthF);
  const boxTop = clampRange(anchorY + box.offTopF, 0, 1 - box.heightF);
  // position.x/y are 0..1 fractions by schema (schemas.py Position ge=0 le=1), and
  // update_text_spec re-validates -- an out-of-range anchor is a 400, not a
  // rendering nicety. Two reachable escapes: a font whose fontBoundingBox exceeds
  // its content area gives offTopF>0 -> negative y at the top edge; a box wider than
  // the frame (widthF>1, the unbreakable-word case) gives x<0 (left) / x>1 (right)
  // since clampRange tolerates a>b. Clamp the RETURNED anchor as the final step.
  return {
    x: round3(clampRange(boxLeft - box.offLeftF, 0, 1)),
    y: round3(clampRange(boxTop - box.offTopF, 0, 1)),
  };
}

export default function TextOverlayPreview({
  videoRef,
  videoMetadata,
  textOverlays = [],
  currentTime,
  selectedRegionId = null,
  selectedElementId = null,
  onMoveTextPosition,
  zoom = 1,
  panOffset = { x: 0, y: 0 },
  isFullscreen = false,
}) {
  const { rect } = useVideoDisplayRect(videoRef, videoMetadata, { zoom, panOffset, isFullscreen });

  // The frame-sized overlay div (its on-screen rect IS the displayed video
  // frame); measured for the pointer->fraction transform and the grab box.
  const overlayRef = useRef(null);
  // The selected element's host div, so its rendered <span> can be measured.
  const selectedHostRef = useRef(null);

  // Rendered text box of the SELECTED element, RELATIVE to its anchor, in frame
  // fractions. Null until measured. Drives both the grab-frame geometry and the
  // drag clamp. Kept in state (not a ref) because the grab frame renders from it.
  const [grabBox, setGrabBox] = useState(null);

  // The selected element's live position, held in a ref so the measurement
  // effect can subtract it WITHOUT re-running on every position change (offsets
  // are position-invariant, and re-running mid-drag would churn the observer).
  const selectedPosRef = useRef(null);

  // Transient drag state in refs (HighlightOverlay idiom): set synchronously on
  // pointerdown so the very first pointermove reads current values with zero
  // re-render lag (T5380 -- a useEffect-gated listener races the first move).
  const dragRef = useRef(null);

  const dragActive = onMoveTextPosition && selectedElementId;

  const activeRegions = textOverlays.filter((region) => {
    if (region.id === selectedRegionId) return true;
    return region.startTime <= currentTime && currentTime < region.endTime;
  });

  // Flatten active regions' elements -- ALL elements of an active region
  // render at once (the core round-4 fix: two elements in the SAME region
  // now share one time window and render TOGETHER, not "only the second one
  // showed up"). Each element keeps its own spec (position/styling).
  const visibleElements = activeRegions.flatMap((region) =>
    (region.elements || [])
      .filter((element) => element.enabled !== false) // hidden wins (T6620)
      .map((element) => ({ ...element, regionId: region.id }))
  );

  const selectedElement = visibleElements.find((el) => el.id === selectedElementId) || null;
  const selectedSpec = selectedElement ? selectedElement.spec : null;
  selectedPosRef.current = selectedSpec ? selectedSpec.position : null;

  // Re-measure whenever the SIZE/OFFSET-affecting spec fields change (NOT
  // position -- that moves the box rigidly, offsets are invariant, so excluding
  // it means a drag never re-runs this effect) or the frame resizes. A
  // ResizeObserver additionally catches the async font-settle (RichText's metrics
  // stabilise over a few rAFs, changing the span size after mount).
  const measureKey = selectedSpec
    ? `${selectedSpec.text}|${selectedSpec.size}|${selectedSpec.align}|${selectedSpec.maxWidth}|${selectedSpec.font}`
    : null;
  const frameW = rect ? rect.width : 0;
  const frameH = rect ? rect.height : 0;

  // Measure the selected element's rendered <span> box, RELATIVE to its anchor,
  // in frame fractions. Reads the live DOM, so it reflects the actual wrapped ink
  // (short vs long strings differ). Returns null until the refs/rect are ready.
  const measureSpanBox = useCallback(() => {
    const host = selectedHostRef.current;
    const frameEl = overlayRef.current;
    const pos = selectedPosRef.current;
    if (!host || !frameEl || !pos) return null;
    const span = host.querySelector('span');
    if (!span) return null;
    const fr = frameEl.getBoundingClientRect();
    const sr = span.getBoundingClientRect();
    if (!fr.width || !fr.height) return null;
    return {
      offLeftF: (sr.left - fr.left) / fr.width - pos.x,
      offTopF: (sr.top - fr.top) / fr.height - pos.y,
      widthF: sr.width / fr.width,
      heightF: sr.height / fr.height,
    };
  }, []);

  useLayoutEffect(() => {
    const host = selectedHostRef.current;
    if (!host || !frameW || !frameH) {
      setGrabBox(null);
      return undefined;
    }
    const span = host.querySelector('span');
    if (!span) {
      setGrabBox(null);
      return undefined;
    }
    const measure = () => {
      const next = measureSpanBox();
      if (!next) return;
      setGrabBox((prev) => {
        if (
          prev &&
          Math.abs(prev.offLeftF - next.offLeftF) < 1e-4 &&
          Math.abs(prev.offTopF - next.offTopF) < 1e-4 &&
          Math.abs(prev.widthF - next.widthF) < 1e-4 &&
          Math.abs(prev.heightF - next.heightF) < 1e-4
        ) {
          return prev;
        }
        return next;
      });
    };
    measure();
    let observer;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(measure);
      observer.observe(span);
    }
    return () => observer?.disconnect();
  }, [selectedElementId, measureKey, frameW, frameH, measureSpanBox]);

  const handlePointerMove = useCallback((e) => {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    if (!d.moved) {
      const mdx = e.clientX - d.startX;
      const mdy = e.clientY - d.startY;
      if (mdx * mdx + mdy * mdy > TAP_SLOP_SQ) d.moved = true;
    }
    if (!d.moved) return;
    const anchorX = d.pos0.x + (e.clientX - d.startX) / d.frameW;
    const anchorY = d.pos0.y + (e.clientY - d.startY) / d.frameH;
    const clamped = clampAnchorToFrame(anchorX, anchorY, d.box);
    d.latest = clamped;
    // LOCAL-only during the drag (commit=false): no network write, preview tracks
    // every tick. Spread the drag-start spec so ONLY position changes.
    onMoveTextPosition(d.elementId, { ...d.spec, position: clamped }, false);
  }, [onMoveTextPosition]);

  const endDrag = useCallback((e) => {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    // A drag (moved past slop) commits EXACTLY ONCE (commit=true). A tap
    // (no move) commits nothing -- the element is already selected.
    if (d.moved) {
      onMoveTextPosition(d.elementId, { ...d.spec, position: d.latest }, true);
    }
    window.removeEventListener('touchmove', preventDefaultTouch);
    dragRef.current = null;
  }, [onMoveTextPosition]);

  const beginDrag = useCallback((e) => {
    if (!dragActive || !selectedSpec) return;
    // Measure FRESH at pointerdown so the clamp uses the CURRENT rendered box,
    // never a stale `grabBox` still settling from a text/size change (the whole
    // reason a lagging state box is not trusted here -- no fallback to it).
    const box = measureSpanBox();
    if (!box) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    window.addEventListener('touchmove', preventDefaultTouch, { passive: false });
    const fr = overlayRef.current.getBoundingClientRect();
    dragRef.current = {
      pointerId: e.pointerId,
      elementId: selectedElementId,
      startX: e.clientX,
      startY: e.clientY,
      pos0: { x: selectedSpec.position.x, y: selectedSpec.position.y },
      spec: selectedSpec,
      box,
      frameW: fr.width || frameW,
      frameH: fr.height || frameH,
      moved: false,
      latest: { x: selectedSpec.position.x, y: selectedSpec.position.y },
    };
  }, [dragActive, selectedElementId, selectedSpec, frameW, frameH, measureSpanBox]);

  // Unmount safety: never leave the document-level touchmove blocker attached
  // (a lingering one would freeze page scroll).
  useEffect(() => () => window.removeEventListener('touchmove', preventDefaultTouch), []);

  if (!rect || !rect.width || !rect.height) return null;
  if (visibleElements.length === 0) return null;

  // Grab frame for the selected element, positioned from its LIVE anchor + the
  // measured box offsets (so it tracks the text during a drag with no
  // re-measurement). Padded a few px for grabbability.
  const grabFrame = dragActive && selectedElement && grabBox && selectedSpec ? (() => {
    const leftPx = (selectedSpec.position.x + grabBox.offLeftF) * rect.width - GRAB_PAD_PX;
    const topPx = (selectedSpec.position.y + grabBox.offTopF) * rect.height - GRAB_PAD_PX;
    const widthPx = grabBox.widthF * rect.width + GRAB_PAD_PX * 2;
    const heightPx = grabBox.heightF * rect.height + GRAB_PAD_PX * 2;
    return (
      <div
        data-testid={`text-drag-frame-${selectedElement.id}`}
        onPointerDown={beginDrag}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        // T6080: swallow the synthetic click trailing a drag's pointerup so it
        // can't bubble to OverlayModeView's handleVideoAreaTap (mobile fullscreen
        // onClick), which would togglePlay() on every completed text drag.
        onClick={(e) => e.stopPropagation()}
        className="absolute rounded-sm cursor-move"
        style={{
          left: `${leftPx}px`,
          top: `${topPx}px`,
          width: `${widthPx}px`,
          height: `${heightPx}px`,
          pointerEvents: 'auto',
          touchAction: 'none',
          border: '1.5px dashed rgba(34, 211, 238, 0.9)',
        }}
      />
    );
  })() : null;

  return (
    <div
      ref={overlayRef}
      className="absolute pointer-events-none"
      style={{ left: rect.offsetX, top: rect.offsetY, width: rect.width, height: rect.height }}
    >
      {visibleElements.map((element) => (
        <div
          key={element.id}
          ref={element.id === selectedElementId ? selectedHostRef : undefined}
          data-testid={`text-preview-element-${element.id}`}
          className="absolute inset-0"
        >
          <RichText spec={element.spec} boxWidth={rect.width} boxHeight={rect.height} />
        </div>
      ))}
      {grabFrame}
    </div>
  );
}
