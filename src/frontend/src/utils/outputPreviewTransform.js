import { videoToScreenRect } from '../hooks/useVideoDisplayRect';

/**
 * T9950 Slice 3 -- the output-aspect moving preview is a re-framing of the
 * EXISTING player, not a second player (design doc §4, P1). This is the exact
 * inverse of `videoToScreenRect`: given the on-screen rect the current crop
 * occupies, find the `scale`/`translate` that stretches that rect to fill the
 * whole stage box, with `transform-origin: 0 0`.
 *
 * Pure, no DOM: `displayRect` is the video->screen mapping from
 * `useVideoDisplayRect` (computed at zoom=1/panOffset={x:0,y:0} by the caller,
 * so the editor's inspection zoom never leaks into the preview -- design doc
 * §4 landmine 2). `containerWidth`/`containerHeight` are the stage box's own
 * pixel size; FocusModeView derives them from that SAME displayRect
 * (`offsetX`/`offsetY` are exactly half the letterbox/pillarbox gap when
 * panOffset is zero, so `containerWidth = displayRect.width + 2*offsetX`)
 * rather than a second DOM measurement.
 *
 * Fails closed (design doc §4): incomplete inputs return `null` -- no preview
 * rather than a wrong one.
 *
 * @param {Object} args
 * @param {{x:number,y:number,width:number,height:number}} args.crop - video-space crop rect (currentCropState)
 * @param {{offsetX:number,offsetY:number,width:number,height:number,scaleX:number,scaleY:number}} args.displayRect
 * @param {number} args.containerWidth
 * @param {number} args.containerHeight
 * @returns {{transform: string, transformOrigin: string, scale: number} | null}
 */
export function computeOutputPreviewTransform({ crop, displayRect, containerWidth, containerHeight }) {
  if (!crop || !displayRect || !containerWidth || !containerHeight) return null;
  if (!crop.width || !crop.height) return null;

  const cropScreen = videoToScreenRect(displayRect, crop.x, crop.y, crop.width, crop.height);
  if (!cropScreen.width || !cropScreen.height) return null;

  const scale = containerWidth / cropScreen.width;
  if (!Number.isFinite(scale) || scale <= 0) return null;

  return {
    transform: `scale(${scale}) translate(${-cropScreen.x}px, ${-cropScreen.y}px)`,
    transformOrigin: '0 0',
    scale,
  };
}
