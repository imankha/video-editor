// T5205 — the shared, presentational card PREVIEW (browser render, no backend
// call). Used at two sizes: a static tile in the library grid, and the base
// layer under the editor's interactive stage. Props in, no store, no fetch.
//
// It composes: the treatment backdrop + the focal-framed photo. TEXT SLOTS are
// drawn only when a `geometry` map is supplied — that map is T5210's composition
// geometry contract (normalised rect per slot per aspect), which this screen
// imports once it lands on master. Until then the preview shows the treatment +
// photo faithfully and omits slot text rather than inventing positions.

import { RichText } from '../RichText';
import { selectCardComposition } from '../../utils/introCardComposition';
import { treatmentMeta } from './introCardEditorConstants';

/**
 * Resolve the effective photo framing for a card. Card focal/zoom win; a NULL on
 * any of them means "inherit the profile's framing" (epic decision 3b). The
 * profile does not yet store a focal point, so inheritance currently resolves to
 * centred, un-zoomed framing — the documented fallback until profile framing
 * ships.
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
 * Value a slot displays: the card's title text for the title slot, the profile
 * fact for a fact slot. Returns '' when unset (caller decides whether that is an
 * inline "fill it" prompt or just an absent line).
 */
export function slotDisplayText(slot, card, profile) {
  if (slot === 'title') return card?.title_text || '';
  return (profile && profile[slot]) || '';
}

export function IntroCardPreview({
  card,
  profile,
  boxWidth,
  boxHeight,
  geometry = null,
}) {
  const treatment = treatmentMeta(card?.treatment);
  const composition = selectCardComposition(card);
  const { focalX, focalY, zoom } = resolveFraming(card, profile);
  const photoUrl = card?.image_key ? card?.previewUrl : null;

  return (
    <div
      className="relative overflow-hidden"
      style={{ width: `${boxWidth}px`, height: `${boxHeight}px`, ...treatment.stageStyle }}
      data-composition={composition}
      data-treatment={treatment.key}
    >
      {photoUrl && (
        <img
          src={photoUrl}
          alt=""
          draggable={false}
          className="absolute inset-0 w-full h-full select-none pointer-events-none"
          style={{
            objectFit: 'cover',
            objectPosition: `${focalX * 100}% ${focalY * 100}%`,
            transform: `scale(${zoom})`,
            transformOrigin: `${focalX * 100}% ${focalY * 100}%`,
          }}
        />
      )}

      {/* Text slots: only with T5210 composition geometry. Each slot renders one
          RichText at its normalised rect, its text from the canonical source
          (title_text / profile fact) merged over the stored STYLING spec. */}
      {geometry &&
        Object.entries(geometry).map(([slot, rect]) => {
          const spec = card?.text_elements?.[slot];
          const text = slotDisplayText(slot, card, profile);
          if (!spec || !text) return null;
          const merged = {
            ...spec,
            text,
            position: rect.position,
            maxWidth: rect.maxWidth,
          };
          return (
            <div key={slot} className="absolute inset-0">
              <RichText spec={merged} boxWidth={boxWidth} boxHeight={boxHeight} />
            </div>
          );
        })}
    </div>
  );
}

export default IntroCardPreview;
