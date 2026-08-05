// T5205 — the shared, presentational card PREVIEW (browser render, no backend
// call). Used at two sizes: a static tile in the library grid, and the base layer
// under the editor's interactive stage. Props in, no store, no fetch.
//
// It composes, from T5210's shared contract, exactly what the render engine draws:
// the treatment backdrop + the focal-framed photo in its composition rect + the
// legibility scrim + one RichText per text slot at its contract geometry (styling
// merged over layout — see introCardPreviewElements). What the editor previews is
// what player_intro.py renders.

import { RichText } from '../RichText';
import { selectCardComposition } from '../../utils/introCardComposition';
import { geometryFor, CARD_ASPECTS } from '../../utils/introCardGeometry';
import {
  treatmentBackgroundCss, photoStyleFor, scrimBackground,
  bandStyleFor, photoTintCss, photoVignetteCss,
} from './introCardVisual';
import { buildPreviewElements, resolveTitleText } from './introCardPreviewElements';

/**
 * Resolve the effective photo framing for a card. Card focal/zoom win; a NULL on
 * any of them means "inherit the profile's framing" (epic decision 3b). The
 * profile does not yet store a focal point, so inheritance currently resolves to
 * centred, un-zoomed framing — the documented fallback until profile framing ships.
 */
export function resolveFraming(card, profile) {
  const pick = (cardVal, profileVal, fallback) =>
    cardVal != null ? cardVal : profileVal != null ? profileVal : fallback;
  return {
    focalX: pick(card?.focal_x, profile?.introFocalX, 0.5),
    focalY: pick(card?.focal_y, profile?.introFocalY, 0.5),
    zoom: pick(card?.zoom, profile?.introZoom, 1.0),
  };
}

/**
 * Value a slot displays: the profile's full name for the title slot (T6570;
 * title_text a legacy override), the profile fact for a fact slot. '' when unset.
 */
export function slotDisplayText(slot, card, profile) {
  if (slot === 'title') return resolveTitleText(card, profile);
  if (slot === 'subtitle') return card?.subtitle_text || ''; // free text on the card (T6570)
  return (profile && profile[slot]) || '';
}

export function IntroCardPreview({
  card,
  profile,
  boxWidth,
  boxHeight,
  aspect = CARD_ASPECTS.portrait,
  renderSlots = true,
}) {
  const composition = selectCardComposition(card);
  const geo = geometryFor(composition, aspect);
  const framing = resolveFraming(card, profile);
  const photoUrl = card?.image_key ? card?.previewUrl : null;
  const hasPhoto = !!card?.image_key;

  const treatment = card?.treatment || 'gold';
  const { rectStyle, imgStyle } = photoStyleFor(geo.photo, framing, boxWidth, boxHeight);
  const scrim = scrimBackground(composition, hasPhoto, treatment);
  // Treatment-owned photo grade + lower-third band (T6580 item 4), all from the
  // shared contract so the export matches.
  const tint = hasPhoto ? photoTintCss(treatment) : null;
  const vignette = hasPhoto ? photoVignetteCss(treatment) : null;
  const bandStyle = hasPhoto ? bandStyleFor(composition, treatment, boxWidth, boxHeight) : null;
  const elements = renderSlots ? buildPreviewElements(card, profile, composition, aspect) : [];

  return (
    <div
      className="relative overflow-hidden"
      style={{ width: `${boxWidth}px`, height: `${boxHeight}px`, background: treatmentBackgroundCss(treatment) }}
      data-composition={composition}
      data-treatment={treatment}
    >
      {photoUrl && (
        <div style={rectStyle}>
          <img src={photoUrl} alt="" draggable={false} className="select-none pointer-events-none" style={imgStyle} />
          {/* Photo grade (C): a colour wash then a vignette, clipped to the photo. */}
          {tint && <div className="absolute inset-0 pointer-events-none" style={{ background: tint }} />}
          {vignette && <div className="absolute inset-0 pointer-events-none" style={{ background: vignette }} />}
          {scrim && <div className="absolute inset-0 pointer-events-none" style={{ background: scrim }} />}
        </div>
      )}

      {/* Accent band (B): a frame-level lower-third ground, above the photo grade
          and below the text. */}
      {bandStyle && <div style={bandStyle} />}

      {elements.map(({ slot, spec }) => (
        <div key={slot} className="absolute inset-0 pointer-events-none">
          <RichText spec={spec} boxWidth={boxWidth} boxHeight={boxHeight} />
        </div>
      ))}
    </div>
  );
}

export default IntroCardPreview;
