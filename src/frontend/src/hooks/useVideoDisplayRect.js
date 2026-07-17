import { useState, useLayoutEffect, useCallback } from 'react';

/**
 * useVideoDisplayRect — the single source of truth for the video -> screen
 * coordinate transform used by every overlay (crop, highlight, player detection).
 *
 * A video is aspect-fit (letterboxed/pillarboxed) inside its `.video-container`,
 * then zoomed and panned. Overlays draw in the video's native coordinate space
 * (`videoMetadata.width` x `videoMetadata.height`) and need to map those coords to
 * on-screen pixels relative to the container. This hook computes that mapping once
 * and hands back `{ rect, videoToScreen, screenToVideo }`.
 *
 * It ships BOTH fixes that previously existed in only one copy each:
 *   - first-paint: `useLayoutEffect` so `rect` is ready before the browser paints
 *     (no one-frame flash of an unplaced overlay).
 *   - rAF-leak / fullscreen-settle: a double `requestAnimationFrame` lets layout
 *     settle after a fullscreen toggle, and BOTH frame ids are cancelled on cleanup
 *     so no callback leaks past unmount.
 */

/** Round to 3 decimal places — matches the precision the backend stores. */
export const round3 = (value) => Math.round(value * 1000) / 1000;

/**
 * Pure aspect-fit geometry: the letterboxed/pillarboxed rect of a video inside its
 * container, with zoom and pan applied. Kept pure (no DOM) so the math is directly
 * unit-testable.
 *
 * @returns {{ offsetX, offsetY, width, height, scaleX, scaleY, zoom, panOffset }}
 *   offsetX/Y: top-left of the displayed video relative to the container.
 *   width/height: on-screen size of the displayed video.
 *   scaleX/Y: displayed pixels per native video pixel.
 */
export function computeVideoDisplayRect({
  containerWidth,
  containerHeight,
  videoWidth,
  videoHeight,
  zoom = 1,
  panOffset = { x: 0, y: 0 },
}) {
  const videoAspect = videoWidth / videoHeight;
  const containerAspect = containerWidth / containerHeight;

  let baseDisplayWidth, baseDisplayHeight;

  if (containerAspect > videoAspect) {
    // Container is wider than the video — video is constrained by height (pillarbox).
    baseDisplayHeight = containerHeight;
    baseDisplayWidth = baseDisplayHeight * videoAspect;
  } else {
    // Container is taller than the video — video is constrained by width (letterbox).
    baseDisplayWidth = containerWidth;
    baseDisplayHeight = baseDisplayWidth / videoAspect;
  }

  const displayWidth = baseDisplayWidth * zoom;
  const displayHeight = baseDisplayHeight * zoom;

  const offsetX = (containerWidth - displayWidth) / 2 + panOffset.x;
  const offsetY = (containerHeight - displayHeight) / 2 + panOffset.y;

  return {
    offsetX,
    offsetY,
    width: displayWidth,
    height: displayHeight,
    scaleX: displayWidth / videoWidth,
    scaleY: displayHeight / videoHeight,
    zoom,
    panOffset,
  };
}

/**
 * Pure: video-space coords -> screen coords (relative to the container).
 * `w`/`h` are dimensions (crop size, or an ellipse's radiusX/radiusY) — they scale
 * without the offset.
 */
export function videoToScreenRect(rect, x, y, w, h) {
  if (!rect) return { x: 0, y: 0, width: 0, height: 0 };
  return {
    x: x * rect.scaleX + rect.offsetX,
    y: y * rect.scaleY + rect.offsetY,
    width: w * rect.scaleX,
    height: h * rect.scaleY,
  };
}

/** Pure inverse: screen coords (relative to the container) -> video-space coords. */
export function screenToVideoRect(rect, x, y, w, h) {
  if (!rect) return { x: 0, y: 0, width: 0, height: 0 };
  return {
    x: round3((x - rect.offsetX) / rect.scaleX),
    y: round3((y - rect.offsetY) / rect.scaleY),
    width: round3(w / rect.scaleX),
    height: round3(h / rect.scaleY),
  };
}

export default function useVideoDisplayRect(
  videoRef,
  videoMetadata,
  { zoom = 1, panOffset = { x: 0, y: 0 }, isFullscreen = false } = {}
) {
  const [rect, setRect] = useState(null);

  // useLayoutEffect (not useEffect) so `rect` is computed before the first paint —
  // the overlay is placed on its very first render instead of one frame late.
  useLayoutEffect(() => {
    if (!videoRef?.current || !videoMetadata) return;

    const updateRect = () => {
      const video = videoRef.current;
      if (!video) return;

      const container = video.closest('.video-container');
      if (!container) return;

      const containerRect = container.getBoundingClientRect();
      setRect(
        computeVideoDisplayRect({
          containerWidth: containerRect.width,
          containerHeight: containerRect.height,
          videoWidth: videoMetadata.width,
          videoHeight: videoMetadata.height,
          zoom,
          panOffset,
        })
      );
    };

    updateRect();
    window.addEventListener('resize', updateRect);

    // Double rAF lets layout settle after a fullscreen toggle; track BOTH frame ids
    // so cleanup cancels the inner frame too (no leaked rAF callback on unmount).
    let innerRafId;
    const outerRafId = requestAnimationFrame(() => {
      innerRafId = requestAnimationFrame(updateRect);
    });

    return () => {
      window.removeEventListener('resize', updateRect);
      cancelAnimationFrame(outerRafId);
      cancelAnimationFrame(innerRafId);
    };
    // isFullscreen is a dependency so the rect recomputes (with settle) on toggle,
    // even though it isn't read directly inside the effect.
  }, [videoRef, videoMetadata, zoom, panOffset, isFullscreen]);

  const videoToScreen = useCallback(
    (x, y, w, h) => videoToScreenRect(rect, x, y, w, h),
    [rect]
  );
  const screenToVideo = useCallback(
    (x, y, w, h) => screenToVideoRect(rect, x, y, w, h),
    [rect]
  );

  return { rect, videoToScreen, screenToVideo };
}
