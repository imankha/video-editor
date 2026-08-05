// T5205 — pure visual helpers shared by the static preview and the motion
// preview, sourced from T5210's shared contract (introCardGeometry.js) so the
// browser look matches the render engine. No React, no store.

import { treatmentFor, bandKind } from '../../utils/introCardGeometry';

/** The treatment backdrop CSS (radial gradient / solid) from the shared contract. */
export function treatmentBackgroundCss(treatment) {
  return treatmentFor(treatment).background.css;
}

/** The treatment's accent colour (title default) from the shared contract. */
export function treatmentAccent(treatment) {
  return treatmentFor(treatment).accent;
}

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** The treatment's band spec (T6580 item 4), or null when it has no band. */
export function treatmentBand(treatment) {
  return treatmentFor(treatment).band || null;
}

/**
 * The lower-third BAND that grounds the text (T6580 item 4). Applies only to the
 * band compositions (hero/broadcast) and only when the treatment defines a band
 * (photo-forward has none). Returns an absolute-position style for a bottom band
 * of the contract's explicit `heightFrac`, filled with the treatment colour and
 * a feathered top edge; null when it does not apply. The renderer engine paints
 * the SAME band (player_intro._render_band).
 */
export function bandStyleFor(composition, treatment, boxW, boxH) {
  if (bandKind(composition) !== 'bottom') return null;
  const band = treatmentBand(treatment);
  if (!band) return null;
  const [r, g, b] = hexToRgb(band.color);
  const solidTo = (1 - band.featherFrac) * 100; // opaque from the bottom up to here
  return {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: `${band.heightFrac * boxH}px`,
    background:
      `linear-gradient(to top, rgba(${r},${g},${b},${band.opacity}) 0%, `
      + `rgba(${r},${g},${b},${band.opacity}) ${solidTo}%, rgba(${r},${g},${b},0) 100%)`,
    pointerEvents: 'none',
  };
}

/** The treatment's photo TINT (a normal-alpha colour wash) as a CSS colour, or null. */
export function photoTintCss(treatment) {
  const tint = treatmentFor(treatment).photoMood?.tint;
  if (!tint) return null;
  const [r, g, b] = hexToRgb(tint.color);
  return `rgba(${r},${g},${b},${tint.opacity})`;
}

/**
 * The treatment's photo VIGNETTE as a CSS radial-gradient, or null. Encoded with
 * an explicit `extent` so the browser and the engine compute the SAME normalised
 * radial distance (mirrors the background-gradient convention): transparent
 * within `innerFrac` of the ellipse, ramping to `opacity` black at its edge.
 */
export function photoVignetteCss(treatment) {
  const v = treatmentFor(treatment).photoMood?.vignette;
  if (!v) return null;
  const pct = (v.extent * 100).toFixed(2);
  return `radial-gradient(${pct}% ${pct}% at 50% 50%, `
    + `rgba(0,0,0,0) ${(v.innerFrac * 100).toFixed(2)}%, rgba(0,0,0,${v.opacity}) 100%)`;
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
export function scrimBackground(composition, hasPhoto, treatment) {
  if (!hasPhoto) return null;
  if (composition === 'title-only') return 'rgba(0, 0, 0, 0.35)'; // dim: alpha 90/255
  if (composition === 'hero' || composition === 'broadcast') {
    // A treatment BAND grounds the text instead of the scrim (T6580 item 4);
    // when there is no band (photo-forward), keep the bottom scrim so the photo
    // still reads under legible text. Mirrors player_intro._scrim_kind.
    if (bandKind(composition) === 'bottom' && treatmentBand(treatment)) return null;
    // bottom: transparent above 45% height, ramping to ~78% black at the base.
    return 'linear-gradient(to top, rgba(0,0,0,0.78) 0%, rgba(0,0,0,0) 55%)';
  }
  return null;
}
