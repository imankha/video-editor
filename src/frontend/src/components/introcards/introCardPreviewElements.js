// T5205 — assemble the card's text elements for the browser preview, mirroring
// `player_intro._merge_spec` + element selection EXACTLY so the preview matches
// the render (epic parity goal). THE seam rules (T5210 contract):
//   - GEOMETRY is ORDINAL (title, fact1..3) and owns size/align/position/maxWidth.
//   - STYLING is SEMANTIC (title/position/class/team) in text_elements and owns
//     ONLY font/colour/shadow/stroke. `.text` is always '' — never read it.
//   - TEXT: title <- card.title_text; factN <- profile[shown_fields[N-1]].
//     A blank value OMITS the line (never a blank render).
//   - Layout ALWAYS wins over anything stored on the styling spec.

import { geometryFor } from '../../utils/introCardGeometry';
import { treatmentAccent } from './introCardVisual';
import { TITLE_SLOT, SUBTITLE_SLOT } from './introCardEditorConstants';

// Defaults mirror player_intro.py (_DEFAULT_*_FONT / _*_SHADOW / _FACT_DEFAULT_COLOR).
export const DEFAULT_TITLE_FONT = 'anton';
export const DEFAULT_FACT_FONT = 'oswald';
export const FACT_DEFAULT_COLOR = '#ffffff';
const TITLE_SHADOW = { blur: 0.06, color: '#000000', opacity: 0.55 };
const FACT_SHADOW = { blur: 0.05, color: '#000000', opacity: 0.5 };
const NO_STROKE = { width: 0, color: '#000000' };

/**
 * The card's TITLE text (T6570): the profile's full name — the name is a
 * property of the ATHLETE, not of a card. A card-level `title_text` is a
 * GRANDFATHERED override for cards authored before T6570; a card created after
 * it never sets one, so it always follows the profile. Mirrors
 * player_intro._select_elements so preview and export agree.
 */
export function resolveTitleText(card, profile) {
  const legacy = (card?.title_text || '').trim();
  if (legacy) return legacy;
  return (profile?.full_name || '').trim();
}

/** Default STYLING for an unstyled slot (font/colour/shadow), by kind. */
export function defaultStyling(kind, accent) {
  if (kind === 'title') {
    return { font: DEFAULT_TITLE_FONT, color: accent, shadow: { ...TITLE_SHADOW } };
  }
  return { font: DEFAULT_FACT_FONT, color: FACT_DEFAULT_COLOR, shadow: { ...FACT_SHADOW } };
}

/**
 * Full TextSpec = card STYLING (font/colour/shadow/stroke) + slot LAYOUT
 * (size/position/maxWidth/align, always winning) + resolved TEXT.
 */
export function mergeSpec(styling, text, slotGeo, kind, accent) {
  const base = styling || defaultStyling(kind, accent);
  return {
    text,
    font: base.font || (kind === 'title' ? DEFAULT_TITLE_FONT : DEFAULT_FACT_FONT),
    color: base.color || (kind === 'title' ? accent : FACT_DEFAULT_COLOR),
    size: slotGeo.size,
    align: slotGeo.align,
    position: { x: slotGeo.x, y: slotGeo.y },
    maxWidth: slotGeo.maxWidth,
    animation: 'none',
    shadow: base.shadow || { blur: 0, color: '#000000', opacity: 0 },
    stroke: base.stroke || { ...NO_STROKE },
  };
}

/**
 * The list of drawable elements for a card at a composition + aspect. Each entry
 * is { slot (semantic styling key), geoSlot (ORDINAL geometry key: title/fact1..),
 * kind, spec }. Omits any line whose text is blank. `geoSlot` is what stagger and
 * geometry key off (mirrors the renderer, which staggers by the geometry slot,
 * NOT by rendered-fact count — matters when an earlier shown fact is blank).
 * @returns {{slot:string, geoSlot:string, kind:string, spec:object}[]}
 */
export function buildPreviewElements(card, profile, composition, aspect) {
  const geo = geometryFor(composition, aspect);
  const slots = geo.slots;
  const textElements = card?.text_elements || {};
  const shownFields = card?.shown_fields || [];
  const accent = treatmentAccent(card?.treatment || 'gold');
  const out = [];

  // Title — the profile's full name (T6570), title_text a legacy override;
  // styling keyed "title".
  const titleText = resolveTitleText(card, profile);
  if (slots[TITLE_SLOT] && titleText) {
    out.push({
      slot: TITLE_SLOT,
      geoSlot: TITLE_SLOT,
      kind: 'title',
      spec: mergeSpec(textElements[TITLE_SLOT], titleText, slots[TITLE_SLOT], 'title', accent),
    });
  }

  // Subtitle — FREE TEXT on the card (T6570; a tournament name etc.). Orthogonal
  // to composition; styling keyed "subtitle". Omitted when blank (never a blank
  // line), exactly like an unset fact. Mirrors player_intro._select_elements.
  const subtitleText = (card?.subtitle_text || '').trim();
  if (slots[SUBTITLE_SLOT] && subtitleText) {
    out.push({
      slot: SUBTITLE_SLOT,
      geoSlot: SUBTITLE_SLOT,
      kind: 'subtitle',
      spec: mergeSpec(textElements[SUBTITLE_SLOT], subtitleText, slots[SUBTITLE_SLOT], 'subtitle', accent),
    });
  }

  // Facts — ORDINAL geometry slot fact{i+1} <- SEMANTIC field shownFields[i]. The
  // ordinal is the shown_fields INDEX (not the rendered count), so a blank
  // earlier fact still leaves its slot empty and the next fact keeps fact{i+1}.
  shownFields.forEach((field, i) => {
    const geoSlot = `fact${i + 1}`;
    const slotGeo = slots[geoSlot];
    if (!slotGeo) return; // more facts than the composition has slots (unreachable)
    const value = ((profile && profile[field]) || '').trim();
    if (!value) return; // unfilled fact -> omitted (the rail prompts to fill it)
    out.push({
      slot: field,
      geoSlot,
      kind: 'fact',
      spec: mergeSpec(textElements[field], value, slotGeo, 'fact', accent),
    });
  });

  return out;
}
