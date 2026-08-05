// T5205 — pure visual helpers shared by the static preview and the motion
// preview, sourced from T5210's shared contract (introCardGeometry.js) so the
// browser look matches the render engine. No React, no store.

import { treatmentFor } from '../../utils/introCardGeometry';

/** The treatment backdrop CSS (radial gradient / solid) from the shared contract. */
export function treatmentBackgroundCss(treatment) {
  return treatmentFor(treatment).background.css;
}

/** The treatment's accent colour (title default) from the shared contract. */
export function treatmentAccent(treatment) {
  return treatmentFor(treatment).accent;
}

/**
 * Absolute-position + size styles for the photo rect and the image within it.
 * The photo fills its composition-defined rect (full-bleed, or an inset column
 * for `recruiting`); the card's normalised focal point + zoom then frame the
 * image INSIDE that rect (epic decision 3b), identically at any aspect.
 * @param {{x:number,y:number,w:number,h:number}} rect  photo rect (0..1 of the box)
 * @param {{focalX:number,focalY:number,zoom:number}} framing
 * @param {number} boxW @param {number} boxH  on-screen box size in px
 */
export function photoStyleFor(rect, framing, boxW, boxH) {
  const objectPosition = `${framing.focalX * 100}% ${framing.focalY * 100}%`;
  return {
    rectStyle: {
      position: 'absolute',
      left: `${rect.x * boxW}px`,
      top: `${rect.y * boxH}px`,
      width: `${rect.w * boxW}px`,
      height: `${rect.h * boxH}px`,
      overflow: 'hidden',
    },
    imgStyle: {
      width: '100%',
      height: '100%',
      objectFit: 'cover',
      objectPosition,
      transform: `scale(${framing.zoom})`,
      transformOrigin: objectPosition,
    },
  };
}

/**
 * The legibility scrim over the photo, mirroring `player_intro._render_scrim` /
 * `_scrim_kind`: `dim` = uniform wash under centred text (title-only), `bottom` =
 * a transparent->dark lower gradient (hero/broadcast), none for recruiting (text
 * sits on the treatment area) or when there is no photo. Returns a CSS `background`
 * string, or null.
 */
export function scrimBackground(composition, hasPhoto) {
  if (!hasPhoto) return null;
  if (composition === 'title-only') return 'rgba(0, 0, 0, 0.35)'; // dim: alpha 90/255
  if (composition === 'hero' || composition === 'broadcast') {
    // bottom: transparent above 45% height, ramping to ~78% black at the base.
    return 'linear-gradient(to top, rgba(0,0,0,0.78) 0%, rgba(0,0,0,0) 55%)';
  }
  return null;
}
