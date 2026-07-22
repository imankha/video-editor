import { useRef, useEffect, useLayoutEffect, useState, useCallback } from 'react';
import { RotateCcw, Minus, Plus } from 'lucide-react';
import versionInfo from '../../../version.json';
import useVideoDisplayRect, { round3 } from '../../../hooks/useVideoDisplayRect';
import { MAX_ROT, rotatedFrameCorners } from '../../../utils/rotationSafeArea';
import { correctionAngle, clampRotation } from '../../../utils/straighten';

/**
 * Get clientX/clientY from a pointer or touch event
 */
function getEventPosition(e) {
  if (e.touches && e.touches.length > 0) {
    return { clientX: e.touches[0].clientX, clientY: e.touches[0].clientY };
  }
  return { clientX: e.clientX, clientY: e.clientY };
}

/**
 * CropOverlay component - renders a draggable/resizable crop rectangle
 * over the video player with 8 resize handles.
 *
 * T5640 — also owns the horizon-straighten UI: it CSS-rotates the <video>
 * element (rotate(-theta) about the display-rect center), draws an out-of-bounds
 * dim mask over the rotated frame's black corners, and hosts the straighten
 * pointer tool + fine dial. The reticle and drag math are UNCHANGED (rotation is
 * NOT threaded into useVideoDisplayRect — crop coords live in rotated-frame space
 * which is screen-aligned); only the drag clamp changes, upstream in the hook.
 */
export default function CropOverlay({
  videoRef,
  videoMetadata,
  currentCrop,
  aspectRatio,
  onCropChange,
  onCropComplete,
  rotation = 0,
  onSetRotation,
  zoom = 1,
  panOffset = { x: 0, y: 0 },
  selectedKeyframeIndex = null,
  isFullscreen = false,
  dimOpacity = 0.2,
  interactive = true
}) {
  // Transient drag/resize state lives in refs (not useState) so the window
  // move/up listeners can be attached synchronously in the pointer-down handler
  // and the FIRST move after mount is never dropped (T5380). An isDragging-gated
  // useEffect commits a tick after the state update, so a fast down->move can fire
  // before the listeners exist. None of this state drives rendering — the crop box
  // re-renders off the currentCrop prop (updated via onCropChange).
  const draggingRef = useRef(false);
  const resizingRef = useRef(false);
  const resizeHandleRef = useRef(null);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const cropStartRef = useRef(null);
  const overlayRef = useRef(null);

  // Single source of truth for the video->screen transform. Ships both fixes
  // (first-paint layout effect + rAF-leak/fullscreen settle) by construction.
  const { rect: videoDisplayRect, videoToScreen } = useVideoDisplayRect(
    videoRef,
    videoMetadata,
    { zoom, panOffset, isFullscreen }
  );

  // T5640: straighten-tool state. `straightenActive` toggles the pointer tool;
  // `straightenLine` holds the live reference line (screen coords) while dragging;
  // `liveRotation` is a memory-only live preview angle (NOT persisted) shown while
  // dragging the straighten line or scrubbing the dial. The committed `rotation`
  // prop is the source of truth; liveRotation just overrides it for the CSS
  // transform during an in-progress gesture.
  const [straightenActive, setStraightenActive] = useState(false);
  const [straightenLine, setStraightenLine] = useState(null);
  const [liveRotation, setLiveRotation] = useState(null);
  const straightenDragRef = useRef(null); // { pointerId, p0 }

  // The angle the video is currently shown at: live preview during a gesture,
  // else the committed value.
  const displayRotation = liveRotation !== null ? liveRotation : rotation;

  // Apply the CSS content rotation to the <video> ELEMENT itself. The element is
  // aspect-fit (object-contain) and centered inside .video-container, so its own
  // bounding box IS the display rect and transform-origin:center rotates about the
  // frame center — the SAME center the export rotates about. rotate(-theta)
  // because CSS positive is clockwise (y-down) while theta is content-CCW.
  // Imperative (not a prop) so we don't fork the shared VideoPlayer, which is
  // mode-agnostic; keyed on displayRotation + rect so it re-applies after reloads.
  useLayoutEffect(() => {
    const video = videoRef?.current;
    if (!video) return undefined;
    video.style.transformOrigin = 'center center';
    video.style.transform = displayRotation ? `rotate(${-displayRotation}deg)` : '';
    return () => {
      // Clear on unmount / when this overlay stops owning the rotation so a
      // future un-rotated clip isn't left tilted.
      if (video) video.style.transform = '';
    };
  }, [videoRef, displayRotation, videoDisplayRect]);

  /**
   * Constrain crop rectangle to video bounds while maintaining aspect ratio
   */
  const constrainCrop = useCallback((crop) => {
    const maxWidth = videoMetadata.width;
    const maxHeight = videoMetadata.height;

    let constrainedCrop = { ...crop };

    // First, ensure dimensions don't exceed video bounds
    if (aspectRatio !== 'free') {
      // Parse aspect ratio
      const [ratioW, ratioH] = aspectRatio.split(':').map(Number);
      const ratio = ratioW / ratioH;

      // If crop exceeds bounds, scale it down while maintaining aspect ratio
      if (constrainedCrop.width > maxWidth || constrainedCrop.height > maxHeight) {
        // Calculate scale factor needed to fit within bounds
        const scaleX = maxWidth / constrainedCrop.width;
        const scaleY = maxHeight / constrainedCrop.height;
        const scale = Math.min(scaleX, scaleY);

        // Scale down proportionally
        constrainedCrop.width = constrainedCrop.width * scale;
        constrainedCrop.height = constrainedCrop.height * scale;

        // Ensure aspect ratio is maintained (due to rounding)
        constrainedCrop.height = constrainedCrop.width / ratio;
      }
    } else {
      // Free aspect ratio - constrain dimensions independently
      constrainedCrop.width = Math.max(10, Math.min(constrainedCrop.width, maxWidth));
      constrainedCrop.height = Math.max(10, Math.min(constrainedCrop.height, maxHeight));
    }

    // Ensure minimum size
    constrainedCrop.width = Math.max(10, constrainedCrop.width);
    constrainedCrop.height = Math.max(10, constrainedCrop.height);

    // Constrain position to keep crop within video bounds
    constrainedCrop.x = Math.max(0, Math.min(constrainedCrop.x, maxWidth - constrainedCrop.width));
    constrainedCrop.y = Math.max(0, Math.min(constrainedCrop.y, maxHeight - constrainedCrop.height));

    return {
      x: round3(constrainedCrop.x),
      y: round3(constrainedCrop.y),
      width: round3(constrainedCrop.width),
      height: round3(constrainedCrop.height)
    };
  }, [videoMetadata, aspectRatio]);

  /**
   * Apply aspect ratio constraint to dimensions
   */
  const applyAspectRatio = useCallback((width, height, handle) => {
    if (aspectRatio === 'free') {
      return { width: round3(width), height: round3(height) };
    }

    const [ratioW, ratioH] = aspectRatio.split(':').map(Number);
    const ratio = ratioW / ratioH;

    // Determine which dimension to constrain based on resize handle
    if (handle && (handle.includes('e') || handle.includes('w'))) {
      // Horizontal resize - adjust height
      height = width / ratio;
    } else if (handle && (handle.includes('n') || handle.includes('s'))) {
      // Vertical resize - adjust width
      width = height * ratio;
    } else {
      // Corner resize - maintain ratio, use smaller dimension
      const currentRatio = width / height;
      if (currentRatio > ratio) {
        width = height * ratio;
      } else {
        height = width / ratio;
      }
    }

    return { width: round3(width), height: round3(height) };
  }, [aspectRatio]);

  // Mirror the latest props/derived values into refs so the drag handlers below
  // can be identity-stable (empty deps). Stable identity is required so that
  // add/removeEventListener always operate on the SAME function reference even if
  // the component re-renders mid-drag (currentCrop changes on every move).
  const videoDisplayRectRef = useRef(videoDisplayRect);
  videoDisplayRectRef.current = videoDisplayRect;
  const currentCropRef = useRef(currentCrop);
  currentCropRef.current = currentCrop;
  const onCropChangeRef = useRef(onCropChange);
  onCropChangeRef.current = onCropChange;
  const onCropCompleteRef = useRef(onCropComplete);
  onCropCompleteRef.current = onCropComplete;
  const constrainCropRef = useRef(constrainCrop);
  constrainCropRef.current = constrainCrop;
  const applyAspectRatioRef = useRef(applyAspectRatio);
  applyAspectRatioRef.current = applyAspectRatio;

  /**
   * Handle pointer/touch move (drag or resize). Reads all transient state from
   * refs so it never sees a stale closure and is safe to attach on the very first
   * mousedown (T5380). Gated on the drag/resize refs — inert when not dragging.
   */
  const handlePointerMove = useCallback((e) => {
    if (!draggingRef.current && !resizingRef.current) return;
    const cropStart = cropStartRef.current;
    const rect = videoDisplayRectRef.current;
    if (!cropStart || !rect) return;

    const pos = getEventPosition(e);
    const deltaX = (pos.clientX - dragStartRef.current.x) / rect.scaleX;
    const deltaY = (pos.clientY - dragStartRef.current.y) / rect.scaleY;

    if (draggingRef.current) {
      // Move crop rectangle
      const newCrop = {
        x: cropStart.x + deltaX,
        y: cropStart.y + deltaY,
        width: cropStart.width,
        height: cropStart.height
      };

      onCropChangeRef.current(constrainCropRef.current(newCrop));
    } else if (resizingRef.current) {
      // Resize crop rectangle
      const resizeHandle = resizeHandleRef.current;
      let newCrop = { ...cropStart };

      if (resizeHandle.includes('n')) {
        newCrop.y = cropStart.y + deltaY;
        newCrop.height = cropStart.height - deltaY;
      }
      if (resizeHandle.includes('s')) {
        newCrop.height = cropStart.height + deltaY;
      }
      if (resizeHandle.includes('w')) {
        newCrop.x = cropStart.x + deltaX;
        newCrop.width = cropStart.width - deltaX;
      }
      if (resizeHandle.includes('e')) {
        newCrop.width = cropStart.width + deltaX;
      }

      // Apply aspect ratio constraint
      const sized = applyAspectRatioRef.current(newCrop.width, newCrop.height, resizeHandle);
      newCrop.width = sized.width;
      newCrop.height = sized.height;

      // Adjust position for top/left resizes to maintain opposite corner
      if (resizeHandle.includes('n')) {
        newCrop.y = cropStart.y + cropStart.height - newCrop.height;
      }
      if (resizeHandle.includes('w')) {
        newCrop.x = cropStart.x + cropStart.width - newCrop.width;
      }

      onCropChangeRef.current(constrainCropRef.current(newCrop));
    }
  }, []);

  /**
   * Handle pointer/touch up (end drag or resize). Detaches the window listeners
   * and emits the completed crop. Reads currentCrop from a ref so the final
   * keyframe reflects the drag, not the value captured at mousedown.
   */
  const handlePointerUp = useCallback(() => {
    const wasActive = draggingRef.current || resizingRef.current;

    draggingRef.current = false;
    resizingRef.current = false;
    resizeHandleRef.current = null;
    cropStartRef.current = null;

    window.removeEventListener('mousemove', handlePointerMove);
    window.removeEventListener('mouseup', handlePointerUp);
    window.removeEventListener('touchmove', handlePointerMove);
    window.removeEventListener('touchend', handlePointerUp);

    if (wasActive) {
      // Notify parent that crop change is complete (create keyframe)
      // IMPORTANT: Only emit spatial properties (x, y, width, height)
      // Do NOT include 'time' - that's managed at the App level
      // Round to 3 decimal places to ensure sync with backend
      const crop = currentCropRef.current;
      onCropCompleteRef.current({
        x: round3(crop.x),
        y: round3(crop.y),
        width: round3(crop.width),
        height: round3(crop.height)
      });
    }
  }, [handlePointerMove]);

  /**
   * Attach the window move+up listeners synchronously (mouse + touch). Called from
   * the pointer-down handlers so the first move is captured with zero re-render lag.
   */
  const attachDragListeners = useCallback(() => {
    window.addEventListener('mousemove', handlePointerMove);
    window.addEventListener('mouseup', handlePointerUp);
    window.addEventListener('touchmove', handlePointerMove, { passive: false });
    window.addEventListener('touchend', handlePointerUp);
  }, [handlePointerMove, handlePointerUp]);

  /**
   * Handle pointer/touch down on crop rectangle (start drag)
   */
  const handleCropPointerDown = (e) => {
    if (e.target.classList.contains('crop-handle')) return;

    e.preventDefault();
    e.stopPropagation();

    const pos = getEventPosition(e);
    draggingRef.current = true;
    resizingRef.current = false;
    dragStartRef.current = { x: pos.clientX, y: pos.clientY };
    cropStartRef.current = currentCrop;
    attachDragListeners();
  };

  /**
   * Handle pointer/touch down on resize handle
   */
  const handleResizePointerDown = (e, handle) => {
    e.preventDefault();
    e.stopPropagation();

    const pos = getEventPosition(e);
    resizingRef.current = true;
    draggingRef.current = false;
    resizeHandleRef.current = handle;
    dragStartRef.current = { x: pos.clientX, y: pos.clientY };
    cropStartRef.current = currentCrop;
    attachDragListeners();
  };

  // Safety net: if the component unmounts mid-drag, detach the window listeners.
  useEffect(() => {
    return () => {
      window.removeEventListener('mousemove', handlePointerMove);
      window.removeEventListener('mouseup', handlePointerUp);
      window.removeEventListener('touchmove', handlePointerMove);
      window.removeEventListener('touchend', handlePointerUp);
    };
  }, [handlePointerMove, handlePointerUp]);

  // ==========================================================================
  // T5640 straighten tool — Pointer Events (real-browser rule: touch-action:none
  // + setPointerCapture + pointerId filter; precedent T5644/T5450).
  // ==========================================================================

  // Screen point relative to the overlay element (matches the reticle's coord
  // space; the actual angle only depends on the delta, so the origin is moot).
  const overlayPoint = useCallback((e) => {
    const host = overlayRef.current;
    const box = host?.getBoundingClientRect();
    return { x: e.clientX - (box?.left || 0), y: e.clientY - (box?.top || 0) };
  }, []);

  const handleStraightenPointerDown = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const p0 = overlayPoint(e);
    straightenDragRef.current = { pointerId: e.pointerId, p0 };
    setStraightenLine({ p0, p1: p0 });
    setLiveRotation(rotation); // start preview from the current angle
  }, [overlayPoint, rotation]);

  const handleStraightenPointerMove = useCallback((e) => {
    const drag = straightenDragRef.current;
    if (!drag || e.pointerId !== drag.pointerId) return;
    const p1 = overlayPoint(e);
    setStraightenLine({ p0: drag.p0, p1 });
    // Live preview (memory-only, NOT persisted) — clamp so the preview matches
    // what will actually commit.
    setLiveRotation(clampRotation(correctionAngle(drag.p0, p1)));
  }, [overlayPoint]);

  const handleStraightenPointerUp = useCallback((e) => {
    const drag = straightenDragRef.current;
    if (!drag || e.pointerId !== drag.pointerId) return;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    const p1 = overlayPoint(e);
    const theta = clampRotation(correctionAngle(drag.p0, p1));
    straightenDragRef.current = null;
    setStraightenLine(null);
    setLiveRotation(null); // committed value takes over via the rotation prop
    // ONE surgical commit (the single gesture).
    onSetRotation?.(theta);
  }, [overlayPoint, onSetRotation]);

  // Fine dial / nudge / reset — each fires ONE commit (not per-tick reactive).
  const nudgeRotation = useCallback((delta) => {
    onSetRotation?.(clampRotation(rotation + delta));
  }, [rotation, onSetRotation]);

  const resetRotation = useCallback(() => {
    if (rotation !== 0) onSetRotation?.(0);
  }, [rotation, onSetRotation]);

  // Slider is a preview-while-scrubbing control: onChange previews (memory-only),
  // onPointerUp/onKeyUp commits ONE value on release.
  const handleSliderChange = useCallback((e) => {
    setLiveRotation(clampRotation(Number(e.target.value)));
  }, []);
  const handleSliderCommit = useCallback(() => {
    if (liveRotation !== null) {
      const theta = liveRotation;
      setLiveRotation(null);
      onSetRotation?.(theta);
    }
  }, [liveRotation, onSetRotation]);

  if (!currentCrop || !videoDisplayRect) {
    return null;
  }

  // Convert crop to screen coordinates
  const screenCrop = videoToScreen(currentCrop.x, currentCrop.y, currentCrop.width, currentCrop.height);

  // [DIAG upload-freeze] Trace NaN in SVG rect attrs. Root cause is usually
  // videoMetadata.width/height being 0/undefined before the video has loaded,
  // or currentCrop containing NaN from an uninitialized keyframe.
  const __diagHasNaN = [screenCrop.x, screenCrop.y, screenCrop.width, screenCrop.height].some(Number.isNaN);
  if (__diagHasNaN) {
    console.warn('[DIAG crop-nan] NaN screenCrop', {
      screenCrop,
      currentCrop,
      videoMetadata: { w: videoMetadata?.width, h: videoMetadata?.height },
      videoDisplayRect: videoDisplayRect && {
        scaleX: videoDisplayRect.scaleX,
        scaleY: videoDisplayRect.scaleY,
        offsetX: videoDisplayRect.offsetX,
        offsetY: videoDisplayRect.offsetY,
        width: videoDisplayRect.width,
        height: videoDisplayRect.height,
      },
    });
  }

  // T5640: out-of-bounds dim mask. The rotated frame's corners (mapped to screen)
  // form a quad; anything OUTSIDE that quad but inside the display rect is a black
  // wedge in the export — dim it as a "here be dragons" cue. Only when rotated.
  const maskQuadPoints = (displayRotation && videoMetadata?.width && videoMetadata?.height)
    ? rotatedFrameCorners(videoMetadata.width, videoMetadata.height, displayRotation)
        .map((c) => {
          const s = videoToScreen(c.x, c.y, 0, 0);
          return `${round3(s.x)},${round3(s.y)}`;
        })
        .join(' ')
    : null;

  /**
   * Check if crop size requires maximum 4x AI upscaling
   * Warns when crop is small enough that it would hit the 1440p limit with 4x upscaling.
   * This means we're using the full upscaling power - any smaller would be clamped.
   *
   * Backend clamps target to 1440p (2560x1440), so crops smaller than 640x360
   * will be upscaled at exactly 4x to reach the limit.
   */
  const isCropTooSmall = () => {
    const cropW = currentCrop.width;
    const cropH = currentCrop.height;

    // Backend clamps to 1440p max (2560x1440)
    // Crops smaller than 1440p/4 will use full 4x upscaling
    const maxW = 2560;
    const maxH = 1440;
    const minCropW = maxW / 4; // 640
    const minCropH = maxH / 4; // 360

    // Warn if BOTH dimensions are smaller than threshold (requires full 4x to reach 1440p)
    // Using AND because if one dimension is large, it won't need full 4x upscaling
    return cropW < minCropW && cropH < minCropH;
  };

  const cropTooSmall = isCropTooSmall();

  const handles = [
    { name: 'nw', cursor: 'nw-resize', x: 0, y: 0 },
    { name: 'n', cursor: 'n-resize', x: 0.5, y: 0 },
    { name: 'ne', cursor: 'ne-resize', x: 1, y: 0 },
    { name: 'e', cursor: 'e-resize', x: 1, y: 0.5 },
    { name: 'se', cursor: 'se-resize', x: 1, y: 1 },
    { name: 's', cursor: 's-resize', x: 0.5, y: 1 },
    { name: 'sw', cursor: 'sw-resize', x: 0, y: 1 },
    { name: 'w', cursor: 'w-resize', x: 0, y: 0.5 }
  ];

  return (
    <div
      ref={overlayRef}
      className="absolute inset-0 pointer-events-none"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%'
      }}
    >
      {/* T5640: out-of-bounds dim mask — the rotated-frame quad as an even-odd hole.
          pointer-events:none so it never eats crop/straighten input. */}
      {maskQuadPoints && (
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none"
          style={{ position: 'absolute', top: 0, left: 0 }}
        >
          <defs>
            <mask id="rotationOobMask">
              <rect width="100%" height="100%" fill="white" />
              <polygon points={maskQuadPoints} fill="black" />
            </mask>
          </defs>
          <rect
            width="100%"
            height="100%"
            fill="rgba(0, 0, 0, 0.55)"
            mask="url(#rotationOobMask)"
          />
        </svg>
      )}

      {/* Dimmed overlay outside crop area */}
      <svg
        className="absolute inset-0 w-full h-full pointer-events-none"
        style={{ position: 'absolute', top: 0, left: 0 }}
      >
        <defs>
          <mask id="cropMask">
            <rect width="100%" height="100%" fill="white" />
            <rect
              x={screenCrop.x}
              y={screenCrop.y}
              width={screenCrop.width}
              height={screenCrop.height}
              fill="black"
            />
          </mask>
        </defs>
        <rect
          width="100%"
          height="100%"
          fill={`rgba(0, 0, 0, ${dimOpacity})`}
          mask="url(#cropMask)"
        />
      </svg>

      {/* Crop rectangle */}
      <div
        className={`absolute border-2 ${interactive ? 'cursor-move pointer-events-auto' : 'pointer-events-none'} ${cropTooSmall ? 'border-red-500' : 'border-white'}`}
        style={{
          left: `${screenCrop.x}px`,
          top: `${screenCrop.y}px`,
          width: `${screenCrop.width}px`,
          height: `${screenCrop.height}px`,
          boxShadow: `0 0 0 9999px rgba(0, 0, 0, ${dimOpacity})`,
          touchAction: 'none'
        }}
        onMouseDown={handleCropPointerDown}
        onTouchStart={handleCropPointerDown}
        title="Drag to move the crop box. Drag corners or edges to resize. This sets the visible area of your highlight."
      >
        {/* Grid lines */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none">
          <line x1="33.33%" y1="0" x2="33.33%" y2="100%" stroke="white" strokeOpacity="0.5" strokeWidth="1" />
          <line x1="66.66%" y1="0" x2="66.66%" y2="100%" stroke="white" strokeOpacity="0.5" strokeWidth="1" />
          <line x1="0" y1="33.33%" x2="100%" y2="33.33%" stroke="white" strokeOpacity="0.5" strokeWidth="1" />
          <line x1="0" y1="66.66%" x2="100%" y2="66.66%" stroke="white" strokeOpacity="0.5" strokeWidth="1" />
        </svg>

        {/* Debug: Show crop size and position when keyframe is selected (only in development mode) */}
        {versionInfo.environment !== 'production' && selectedKeyframeIndex !== null && (
          <div
            className={`absolute left-1/2 transform -translate-x-1/2 bg-black/75 px-2 py-1 rounded text-sm font-mono pointer-events-none whitespace-nowrap ${cropTooSmall ? 'text-red-400' : 'text-yellow-300'}`}
            style={{ top: '-28px' }}
            title={`Crop: ${Math.round(currentCrop.width)}x${Math.round(currentCrop.height)} at position (${Math.round(currentCrop.x)}, ${Math.round(currentCrop.y)})${cropTooSmall ? ' (Too small for optimal 4x upscale)' : ''}`}
          >
            {Math.round(currentCrop.width)}x{Math.round(currentCrop.height)} @ ({Math.round(currentCrop.x)}, {Math.round(currentCrop.y)})
            {cropTooSmall && ' ⚠️'}
          </div>
        )}

        {/* Warning: Show when crop is too small for optimal 4x upscale */}
        {cropTooSmall && (
          <div
            className="absolute left-1/2 transform -translate-x-1/2 bg-red-900/90 text-red-100 px-3 py-1.5 rounded text-xs font-medium pointer-events-none whitespace-nowrap"
            style={{ bottom: '-32px' }}
            title="AI upscaler works best with 4x scaling. Current crop will require more than 4x upscale."
          >
            ⚠️ sub-optimal upscale
          </div>
        )}

        {/* Resize handles — 12px visual, 44px touch target on mobile via ::after */}
        {handles.map(handle => (
          <div
            key={handle.name}
            className={`crop-handle absolute bg-white border-2 ${interactive ? 'pointer-events-auto' : 'pointer-events-none'} ${cropTooSmall ? 'border-red-500' : 'border-blue-500'} after:content-[''] after:absolute after:-inset-4 after:block sm:after:inset-0`}
            style={{
              width: '12px',
              height: '12px',
              left: `${handle.x * 100}%`,
              top: `${handle.y * 100}%`,
              transform: 'translate(-50%, -50%)',
              cursor: handle.cursor,
              zIndex: 10,
              touchAction: 'none'
            }}
            onMouseDown={(e) => handleResizePointerDown(e, handle.name)}
            onTouchStart={(e) => handleResizePointerDown(e, handle.name)}
          />
        ))}
      </div>

      {/* T5640: straighten capture layer — full-overlay pointer surface that is
          ONLY active while the straighten tool is toggled on. Sits above the
          reticle (z-20) so the whole frame is a straighten target. touch-action:
          none + pointer capture + pointerId filter per the real-browser rule. */}
      {straightenActive && onSetRotation && (
        <div
          className="absolute inset-0 pointer-events-auto"
          style={{ touchAction: 'none', cursor: 'crosshair', zIndex: 20 }}
          onPointerDown={handleStraightenPointerDown}
          onPointerMove={handleStraightenPointerMove}
          onPointerUp={handleStraightenPointerUp}
          onPointerCancel={handleStraightenPointerUp}
        >
          {/* Live reference line while dragging */}
          {straightenLine && (
            <svg className="absolute inset-0 w-full h-full pointer-events-none">
              <line
                x1={straightenLine.p0.x}
                y1={straightenLine.p0.y}
                x2={straightenLine.p1.x}
                y2={straightenLine.p1.y}
                stroke="#38bdf8"
                strokeWidth="2"
                strokeDasharray="6 4"
              />
            </svg>
          )}
        </div>
      )}

      {/* T5640: straighten toolbar — toggle, fine dial, nudge, readout, reset.
          pointer-events:auto (parent is none). Toggle button >= 44px per the
          coarse-pointer rule. Only shown when the container wired onSetRotation. */}
      {onSetRotation && interactive && (
        <div
          className="absolute left-1/2 bottom-2 -translate-x-1/2 pointer-events-auto flex items-center gap-2 bg-gray-900/85 border border-gray-700 rounded-lg px-2 py-1.5"
          style={{ zIndex: 30, touchAction: 'none' }}
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => setStraightenActive((v) => !v)}
            className={`flex items-center justify-center min-h-11 min-w-11 px-2 rounded-md text-xs font-medium ${straightenActive ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-200 hover:bg-gray-600'}`}
            title="Straighten: drag along the horizon (or a vertical) to level it"
            aria-pressed={straightenActive}
          >
            Straighten
          </button>

          <button
            type="button"
            onClick={() => nudgeRotation(-0.1)}
            className="flex items-center justify-center h-8 w-8 rounded-md bg-gray-700 text-gray-200 hover:bg-gray-600"
            title="Rotate -0.1 degrees"
            aria-label="Nudge rotation counter"
          >
            <Minus size={14} />
          </button>

          <input
            type="range"
            min={-MAX_ROT}
            max={MAX_ROT}
            step={0.1}
            value={displayRotation}
            onChange={handleSliderChange}
            onPointerUp={handleSliderCommit}
            onKeyUp={handleSliderCommit}
            className="w-28 accent-blue-500"
            title="Fine rotation"
            aria-label="Rotation angle"
          />

          <button
            type="button"
            onClick={() => nudgeRotation(0.1)}
            className="flex items-center justify-center h-8 w-8 rounded-md bg-gray-700 text-gray-200 hover:bg-gray-600"
            title="Rotate +0.1 degrees"
            aria-label="Nudge rotation clockwise"
          >
            <Plus size={14} />
          </button>

          <span className="text-xs text-gray-200 font-mono tabular-nums w-14 text-center">
            {displayRotation.toFixed(1)}°
          </span>

          <button
            type="button"
            onClick={resetRotation}
            className="flex items-center justify-center h-8 w-8 rounded-md bg-gray-700 text-gray-200 hover:bg-gray-600 disabled:opacity-40"
            title="Reset rotation to 0"
            aria-label="Reset rotation"
            disabled={rotation === 0}
          >
            <RotateCcw size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
