// T5205 — assemble the card's text elements for the browser preview, mirroring
// `player_intro._select_elements` + `intro_card_geometry.layout` EXACTLY so the
// preview matches the render (epic parity goal). T6640 THE seam rules:
//   - Typography is TEMPLATE-owned via a fixed ROLE per slot (title/primary/
//     secondary — `ROLE_FOR_SLOT` in the shared contract), never per-card
//     styling. There is no more `text_elements` read here.
//   - POSITION/SIZE are MEASURED (the shared `layout()` mirror below), not a
//     fixed per-slot lookup — this is what guarantees a wrapped title can never
//     collide with the slot below it (see docs/plans/tasks/T6640-design.md §A).
//   - TEXT: title <- profile full_name ALWAYS (T6620; card.title_text is dead);
//     subtitle <- card.subtitle_text; factN <- profile[shown_fields[N-1]].
//     A blank value OMITS the line (never a blank render).

import { geometryFor, ROLE_FOR_SLOT, MUTED_COLOR, STAGGER_ORDER } from '../../utils/introCardGeometry';
import { wrapLines, measureFontMetricsPx } from '../RichText';
import { treatmentAccent } from './introCardVisual';
import { TITLE_SLOT, SUBTITLE_SLOT } from './introCardEditorConstants';

/**
 * The card's TITLE text: the profile's full name, ALWAYS — the name is a
 * property of the ATHLETE, not of a card. T6620: the profile always wins.
 * `card.title_text` (a pre-T6570 grandfathered override) is NO LONGER read —
 * T6570 removed the only UI that could clear it, so a legacy value trapped the
 * card on a stale name forever ("I added my player's name but it won't pull
 * into the card"). The stored column is now dead and is nulled by migration
 * v036. `card` is kept in the signature for call-site symmetry with the fact
 * resolvers. Mirrors player_intro._select_elements so preview and export agree.
 */
export function resolveTitleText(card, profile) {
  return (profile?.full_name || '').trim();
}

// =============================================================================
// MEASURED LAYOUT (T6640) — the JS twin of `intro_card_geometry.layout` on the
// backend. Same rhythm-gap rule, same shrink-to-fit title, same bottom/centre
// anchor math — see the Python module's "MEASURED LAYOUT" docstring section for
// the full algorithm writeup and the collision-safety argument. Font metrics
// use the BARE font key as the CSS family (the @font-face rules register that
// exact family name — `RichText.jsx::injectFontFaces`) and a fixed weight 400
// (RichText's own fallback when a manifest entry isn't available) — this is a
// LIVE-PREVIEW approximation; the backend render is authoritative, and runtime
// agreement between this preview and the actual `<RichText>` output is proven
// by the extended `e2e/T5180-text-parity.spec.js` (T6640 §2c), not by this
// module needing pixel-exact metrics before the font has visually settled.
const PREVIEW_FONT_WEIGHT = 400;

function gapBetween(prevRole, role, reflow) {
  if (prevRole == null) return 0;
  if (prevRole === 'title') return reflow.gapAfterTitle;
  if (prevRole === 'secondary' && role === 'secondary') return reflow.gapLine;
  return reflow.gapGroup;
}

function fitTitle(text, typo, frameW, frameH, maxWidthFrac) {
  let size = typo.size;
  const maxPx = maxWidthFrac * frameW;
  const step = 0.002;
  while (size > typo.minSize) {
    const px = Math.max(Math.round(size * frameH), 1);
    const lines = wrapLines(text, typo.font, px, PREVIEW_FONT_WEIGHT, maxPx);
    if (lines.length <= typo.maxLines) return { size, lines: lines.length };
    size = Math.round((size - step) * 10000) / 10000;
  }
  const px = Math.max(Math.round(typo.minSize * frameH), 1);
  return { size: typo.minSize, lines: wrapLines(text, typo.font, px, PREVIEW_FONT_WEIGHT, maxPx).length };
}

function countLines(text, sizeFrac, fontKey, frameW, frameH, maxWidthFrac) {
  const px = Math.max(Math.round(sizeFrac * frameH), 1);
  return wrapLines(text, fontKey, px, PREVIEW_FONT_WEIGHT, maxWidthFrac * frameW).length;
}

function advanceFrac(sizeFrac, fontKey, frameH) {
  const px = Math.max(Math.round(sizeFrac * frameH), 1);
  const { ascentPx, descentPx } = measureFontMetricsPx(fontKey, px, PREVIEW_FONT_WEIGHT);
  return (ascentPx + descentPx) / frameH;
}

/**
 * Compute the measured, anchored text stack. `elements` is an ORDERED list of
 * `[slot, text]` pairs already filtered to what will render, in STAGGER_ORDER.
 * Returns `{slot: {x, y, size, align, maxWidth, font, color, shadow}}` — every
 * field a full TextSpec needs, so the caller no longer merges any per-card
 * styling. Mirrors `intro_card_geometry.layout` field-for-field.
 * @param {string} composition @param {string} aspect
 * @param {[string, string][]} elements
 * @param {string} accent @param {number} frameW @param {number} frameH
 */
export function layout(composition, aspect, elements, accent, frameW, frameH) {
  const geo = geometryFor(composition, aspect);
  const { reflow, typography } = geo;

  const measured = [];
  let prevRole = null;
  for (const [slot, text] of elements) {
    const role = ROLE_FOR_SLOT[slot];
    const rt = typography[role];
    let size;
    let lines;
    if (role === 'title') {
      ({ size, lines } = fitTitle(text, rt, frameW, frameH, reflow.maxWidth));
    } else {
      size = rt.size;
      lines = countLines(text, size, rt.font, frameW, frameH, reflow.maxWidth);
    }
    const advance = advanceFrac(size, rt.font, frameH);
    const gap = gapBetween(prevRole, role, reflow);
    measured.push({ slot, role, rt, size, lines, advance, gap });
    prevRole = role;
  }

  const total = measured.reduce((s, m) => s + m.lines * m.advance + m.gap, 0);
  const top = reflow.anchorMode === 'bottom' ? reflow.anchorFrac - total : reflow.anchorFrac - total / 2;

  const out = {};
  let y = top;
  for (const m of measured) {
    y += m.gap;
    const color = (m.role === 'title' || m.role === 'primary') ? accent : MUTED_COLOR;
    out[m.slot] = {
      x: reflow.anchorX, y, size: m.size, align: reflow.align, maxWidth: reflow.maxWidth,
      font: m.rt.font, color, shadow: m.rt.shadow,
    };
    y += m.lines * m.advance;
  }
  return out;
}

function specFromLayout(text, pos) {
  return {
    text,
    font: pos.font,
    color: pos.color,
    size: pos.size,
    align: pos.align,
    position: { x: pos.x, y: pos.y },
    maxWidth: pos.maxWidth,
    animation: 'none',
    shadow: pos.shadow,
    stroke: { width: 0, color: '#000000' },
  };
}

/**
 * The list of drawable elements for a card at a composition + aspect + preview
 * box size. Each entry is `{ slot, geoSlot, kind, spec }` (kept for call-site
 * compatibility — `slot === geoSlot` always now, since T6640 dropped the
 * ordinal/semantic split for STYLING; the ordinal/semantic split for the TEXT
 * *source* — factN <- shown_fields[N-1] — is unchanged). Omits any line whose
 * text is blank.
 * @returns {{slot:string, geoSlot:string, kind:string, spec:object}[]}
 */
export function buildPreviewElements(card, profile, composition, aspect, frameW, frameH) {
  const shownFields = card?.shown_fields || [];
  const accent = treatmentAccent(card?.treatment || 'gold');
  const texts = {};

  const titleText = resolveTitleText(card, profile);
  if (titleText) texts[TITLE_SLOT] = titleText;

  const subtitleText = (card?.subtitle_text || '').trim();
  if (subtitleText) texts[SUBTITLE_SLOT] = subtitleText;

  shownFields.forEach((field, i) => {
    const slot = `fact${i + 1}`;
    const value = ((profile && profile[field]) || '').trim();
    if (!value) return; // unfilled fact -> omitted (the rail prompts to fill it)
    texts[slot] = value;
  });

  const ordered = STAGGER_ORDER.filter((slot) => slot in texts).map((slot) => [slot, texts[slot]]);
  if (ordered.length === 0) return [];
  const positions = layout(composition, aspect, ordered, accent, frameW, frameH);

  return ordered.map(([slot, text]) => ({
    slot,
    geoSlot: slot,
    kind: ROLE_FOR_SLOT[slot],
    spec: specFromLayout(text, positions[slot]),
  }));
}
