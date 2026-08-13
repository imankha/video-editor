import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import useVideoDisplayRect, { round3 } from '../../../hooks/useVideoDisplayRect';
import RichText from '../../../components/RichText';
import { isRegionUnderPlayhead } from '../../../utils/textRegionPlayhead';
import { textFadeOutFactor } from '../../../constants/textSpec';

// The dimmed opacity of the editing GHOST -- a selected, out-of-range region
// shown only while paused on the Text tab (T6880). Low enough that it reads as
// "editing preview, not real output", high enough to stay legible/draggable.
const GHOST_OPACITY = 0.35;

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
 * range contains `currentTime` (design O6) -- the SAME shared
 * `isRegionUnderPlayhead` predicate the Text settings panel uses, so the
 * canvas and the panel can never disagree about "under the playhead". Every
 * element of an active region renders, except one individually disabled
 * (T6620's per-element eye).
 *
 * T6880 (editing ghost): the selected-region exception used to render a
 * SELECTED region unconditionally -- even with the playhead dragged past its
 * end, and even during playback -- so the canvas showed "burnt-in" text the
 * panel (strict range) said wasn't there, and playback rendered out-of-range
 * text across the whole clip (preview lying about export). It is now HONEST
 * and NARROW: a selected region whose range does NOT contain the playhead
 * renders ONLY while the Text tab is active AND playback is PAUSED, as a
 * dimmed editing GHOST (reduced opacity) that can never be mistaken for real
 * burn-in, and NEVER during playback. The ghost stays fully draggable
 * (T6720) while paused; pressing play makes it disappear. Real output
 * (playhead in range) is unaffected -- the ghost is layered EXPLICITLY on top
 * of the shared predicate, not baked into it.
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
 *
 * T6720 round 2 (post-push UI feedback): the grab frame's border goes SOLID
 * from pointerdown to pointerup (`isGrabbing`), not just dashed-while-selected,
 * so "selected" and "actively being moved" read as visibly different states.
 * Every visible element (not only the selected one) now gets its own
 * LIVE-measured hit-box (`elementBoxes`, keyed by id, generalized from the
 * single-element `measureSpanBox`/`grabBox` of round 1) so clicking any text
 * ON THE CANVAS selects it via `onSelectElement` -- the same callback
 * `TextManagementPanel`'s rail already uses, so selecting via the rail or via
 * the canvas both land on the same `selectedElementId` and both render the
 * SAME selected-state affordance (there is only one selection state, two ways
 * to set it).
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
  onSelectElement,
  zoom = 1,
  panOffset = { x: 0, y: 0 },
  isFullscreen = false,
  // T6880: the editing-ghost exception (render a selected, out-of-range region
  // for editing) is gated on BOTH -- Text tab active AND playback paused.
  isPlaying = false,
  isTextTabActive = false,
}) {
  const { rect } = useVideoDisplayRect(videoRef, videoMetadata, { zoom, panOffset, isFullscreen });

  // The frame-sized overlay div (its on-screen rect IS the displayed video
  // frame); measured for the pointer->fraction transform and the grab box.
  const overlayRef = useRef(null);
  // Host div for EVERY visible element, keyed by element id -- so each one's
  // rendered <span> can be measured, not just the selected element's. Needed
  // to hit-test click-to-select for elements that aren't currently selected
  // (the selected element additionally gets the drag grab frame below).
  const hostRefsRef = useRef({});

  // Rendered text box of EACH visible element, RELATIVE to its own anchor, in
  // frame fractions, keyed by element id. Null/absent until measured. Drives
  // per-element click hit-targets AND (for the selected element specifically)
  // the grab-frame geometry + drag clamp. Kept in state (not a ref) because
  // hit-targets/the grab frame render from it. Measured live from the DOM --
  // never a fixed size assumption -- so short vs long strings differ (the
  // same lesson the drag clamp bug above was fixed on).
  const [elementBoxes, setElementBoxes] = useState({});

  // True from pointerdown (beginDrag) to pointerup/cancel (endDrag) -- drives
  // the grab frame's dashed (idle, selected) vs solid (actively grabbed) border
  // so a mouse/touch down reads as "you're moving this now", not just "selected".
  const [isGrabbing, setIsGrabbing] = useState(false);

  // The selected element's live position, held in a ref so the measurement
  // effect can subtract it WITHOUT re-running on every position change (offsets
  // are position-invariant, and re-running mid-drag would churn the observer).
  const selectedPosRef = useRef(null);

  // Transient drag state in refs (HighlightOverlay idiom): set synchronously on
  // pointerdown so the very first pointermove reads current values with zero
  // re-render lag (T5380 -- a useEffect-gated listener races the first move).
  const dragRef = useRef(null);

  const dragActive = onMoveTextPosition && selectedElementId;

  // REAL output: regions whose range actually contains the playhead -- the
  // shared predicate the settings panel uses too, so the two surfaces agree by
  // construction (T6880). This IS what export burns in (strict windows).
  const activeRegions = textOverlays.filter((region) => isRegionUnderPlayhead(region, currentTime));

  // Editing GHOST (T6880): the SELECTED region, shown for editing ONLY when it
  // is NOT already real output (playhead outside its range), the Text tab is
  // active, and playback is PAUSED. Never during playback, never off the Text
  // tab -- so it can never masquerade as burnt-in output. Layered explicitly on
  // top of the shared predicate rather than baked into it.
  const ghostRegion =
    !isPlaying && isTextTabActive && selectedRegionId
      ? textOverlays.find(
        (region) => region.id === selectedRegionId && !isRegionUnderPlayhead(region, currentTime),
      ) || null
      : null;

  // Flatten active (+ ghost) regions' elements -- ALL elements of an active
  // region render at once (the core round-4 fix: two elements in the SAME
  // region now share one time window and render TOGETHER, not "only the second
  // one showed up"). Each element keeps its own spec (position/styling); ghost
  // elements carry `isGhost` so they render dimmed.
  const renderRegions = ghostRegion ? [...activeRegions, ghostRegion] : activeRegions;
  const visibleElements = renderRegions.flatMap((region) =>
    (region.elements || [])
      .filter((element) => element.enabled !== false) // hidden wins (T6620)
      .map((element) => ({
        ...element,
        regionId: region.id,
        regionEndTime: region.endTime,
        isGhost: region.id === ghostRegion?.id,
      }))
  );

  const selectedElement = visibleElements.find((el) => el.id === selectedElementId) || null;
  const selectedSpec = selectedElement ? selectedElement.spec : null;
  selectedPosRef.current = selectedSpec ? selectedSpec.position : null;

  // Re-measure whenever the SIZE/OFFSET-affecting spec fields of ANY visible
  // element change (NOT position -- that moves a box rigidly, offsets are
  // invariant, so excluding it means a drag never re-runs this effect) or the
  // frame resizes. A ResizeObserver on the SELECTED element's span additionally
  // catches the async font-settle (RichText's metrics stabilise over a few
  // rAFs, changing the span size after mount) for the one box the drag clamp
  // depends on precisely.
  const elementIdsKey = visibleElements.map((el) => el.id).join(',');
  const measureKey = visibleElements
    .map((el) => `${el.id}:${el.spec.text}|${el.spec.size}|${el.spec.align}|${el.spec.maxWidth}|${el.spec.font}`)
    .join(';');
  const frameW = rect ? rect.width : 0;
  const frameH = rect ? rect.height : 0;

  // Measure one element's rendered <span> box, RELATIVE to its OWN anchor, in
  // frame fractions. Reads the live DOM, so it reflects the actual wrapped ink
  // (short vs long strings differ). Returns null until the refs/rect are ready.
  const measureBoxFor = useCallback((elementId, pos) => {
    const host = hostRefsRef.current[elementId];
    const frameEl = overlayRef.current;
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

  // The selected element's box specifically -- used by the drag clamp, which
  // needs the FRESHEST measurement taken at pointerdown (not the batched
  // `elementBoxes` state, which only re-measures on the effect below).
  const measureSpanBox = useCallback(
    () => measureBoxFor(selectedElementId, selectedPosRef.current),
    [selectedElementId, measureBoxFor]
  );

  useLayoutEffect(() => {
    if (!frameW || !frameH) {
      setElementBoxes({});
      return undefined;
    }
    const measure = () => {
      setElementBoxes((prev) => {
        let changed = false;
        const next = { ...prev };
        visibleElements.forEach((el) => {
          const box = measureBoxFor(el.id, el.spec.position);
          if (!box) return;
          const p = prev[el.id];
          if (
            !p ||
            Math.abs(p.offLeftF - box.offLeftF) >= 1e-4 ||
            Math.abs(p.offTopF - box.offTopF) >= 1e-4 ||
            Math.abs(p.widthF - box.widthF) >= 1e-4 ||
            Math.abs(p.heightF - box.heightF) >= 1e-4
          ) {
            next[el.id] = box;
            changed = true;
          }
        });
        Object.keys(next).forEach((id) => {
          if (!visibleElements.some((el) => el.id === id)) {
            delete next[id];
            changed = true;
          }
        });
        return changed ? next : prev;
      });
    };
    measure();
    let observer;
    const selectedHost = selectedElementId ? hostRefsRef.current[selectedElementId] : null;
    const selectedSpan = selectedHost?.querySelector('span');
    if (typeof ResizeObserver !== 'undefined' && selectedSpan) {
      observer = new ResizeObserver(measure);
      observer.observe(selectedSpan);
    }
    return () => observer?.disconnect();
    // visibleElements is intentionally omitted -- it's a fresh array every
    // render; elementIdsKey + measureKey are its stable content signature.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elementIdsKey, measureKey, frameW, frameH, selectedElementId, measureBoxFor]);

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
    setIsGrabbing(false);
  }, [onMoveTextPosition]);

  const beginDrag = useCallback((e) => {
    if (!dragActive || !selectedSpec) return;
    // Measure FRESH at pointerdown so the clamp uses the CURRENT rendered box,
    // never a stale `elementBoxes` entry still settling from a text/size
    // change (the whole reason a lagging state box is not trusted here -- no
    // fallback to it).
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
    setIsGrabbing(true);
  }, [dragActive, selectedElementId, selectedSpec, frameW, frameH, measureSpanBox]);

  // Unmount safety: never leave the document-level touchmove blocker attached
  // (a lingering one would freeze page scroll).
  useEffect(() => () => window.removeEventListener('touchmove', preventDefaultTouch), []);

  if (!rect || !rect.width || !rect.height) return null;
  if (visibleElements.length === 0) return null;

  const selectedBox = selectedElementId ? elementBoxes[selectedElementId] : null;

  // Grab frame for the selected element, positioned from its LIVE anchor + the
  // measured box offsets (so it tracks the text during a drag with no
  // re-measurement). Padded a few px for grabbability.
  const grabFrame = dragActive && selectedElement && selectedBox && selectedSpec ? (() => {
    const leftPx = (selectedSpec.position.x + selectedBox.offLeftF) * rect.width - GRAB_PAD_PX;
    const topPx = (selectedSpec.position.y + selectedBox.offTopF) * rect.height - GRAB_PAD_PX;
    const widthPx = selectedBox.widthF * rect.width + GRAB_PAD_PX * 2;
    const heightPx = selectedBox.heightF * rect.height + GRAB_PAD_PX * 2;
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
          // Solid while actively grabbed (pointer down), dashed at rest -- the
          // border itself signals "moving now" vs. "selected, drag to move".
          border: isGrabbing
            ? '2px solid rgba(34, 211, 238, 0.95)'
            : '1.5px dashed rgba(34, 211, 238, 0.9)',
        }}
      />
    );
  })() : null;

  // Click-to-select hit-targets for every visible element EXCEPT the selected
  // one (which is already covered by the grab frame above, on top and
  // draggable). Sized to the element's own LIVE-measured box, same as the
  // grab frame -- a fixed/estimated box would mis-hit for a short caption vs.
  // a long title. Tapping selects only (no move -> no persistence write);
  // dragging the newly-selected element is a SEPARATE subsequent gesture.
  const selectTargets = onSelectElement
    ? visibleElements
      .filter((element) => element.id !== selectedElementId)
      .map((element) => {
        const box = elementBoxes[element.id];
        if (!box) return null;
        const leftPx = (element.spec.position.x + box.offLeftF) * rect.width;
        const topPx = (element.spec.position.y + box.offTopF) * rect.height;
        const widthPx = box.widthF * rect.width;
        const heightPx = box.heightF * rect.height;
        return (
          <div
            key={`select-${element.id}`}
            data-testid={`text-select-target-${element.id}`}
            // T6080: stop the click here too -- same mobile-fullscreen
            // togglePlay() bubble risk as the grab frame's onClick above.
            onClick={(e) => { e.stopPropagation(); onSelectElement(element.id, element.regionId); }}
            className="absolute cursor-pointer"
            style={{
              left: `${leftPx}px`,
              top: `${topPx}px`,
              width: `${widthPx}px`,
              height: `${heightPx}px`,
              pointerEvents: 'auto',
            }}
          />
        );
      })
    : null;

  return (
    <div
      ref={overlayRef}
      className="absolute pointer-events-none"
      style={{ left: rect.offsetX, top: rect.offsetY, width: rect.width, height: rect.height }}
    >
      {visibleElements.map((element) => (
        <div
          key={element.id}
          ref={(el) => { hostRefsRef.current[element.id] = el; }}
          data-testid={`text-preview-element-${element.id}`}
          data-ghost={element.isGhost ? 'true' : undefined}
          className="absolute inset-0"
          // T6880: a selected out-of-range region shown for editing renders
          // dimmed so it can never be mistaken for real burn-in output.
          // T6990: real (non-ghost) elements ramp opacity to 0 over the final
          // TEXT_FADE_OUT_SEC of their window, matching the export burn-in
          // envelope so scrubbing across a region's end previews the fade-out.
          style={
            element.isGhost
              ? { opacity: GHOST_OPACITY }
              : (() => {
                const fade = textFadeOutFactor(element.regionEndTime, currentTime);
                return fade < 1 ? { opacity: fade } : undefined;
              })()
          }
        >
          <RichText spec={element.spec} boxWidth={rect.width} boxHeight={rect.height} />
        </div>
      ))}
      {selectTargets}
      {grabFrame}
    </div>
  );
}
