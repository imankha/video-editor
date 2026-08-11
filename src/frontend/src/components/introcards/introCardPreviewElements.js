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

import { useEffect, useMemo, useRef, useState } from 'react';
import { geometryFor, ROLE_FOR_SLOT, MUTED_COLOR, STAGGER_ORDER } from '../../utils/introCardGeometry';
import { wrapLines, measureFontMetricsPx, resolveFontFamily, getFontManifest } from '../RichText';
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
// resolve the REAL fallback-chain family (`RichText.resolveFontFamily`) and
// the REAL manifest weight (falling back to the bare key / weight 400 only
// while the one-time manifest fetch hasn't resolved yet — `RichText`'s own
// fallback for the same case) — round 3 replaced the earlier bare-key/
// hardcoded-400 approximation, since this module's wrap decision is now the
// SINGLE authoritative one (see `lines` below), not a second guess RichText
// re-derives independently.
function weightFor(fontKey, manifest) {
  const entry = manifest && manifest[fontKey];
  return entry ? entry.weight : 400;
}

function gapBetween(prevRole, role, reflow) {
  if (prevRole == null) return 0;
  if (prevRole === 'title') return reflow.gapAfterTitle;
  if (prevRole === 'secondary' && role === 'secondary') return reflow.gapLine;
  return reflow.gapGroup;
}

function fitTitle(text, typo, family, weight, frameW, frameH, maxWidthFrac) {
  let size = typo.size;
  const maxPx = maxWidthFrac * frameW;
  const step = 0.002;
  while (size > typo.minSize) {
    const px = Math.max(Math.round(size * frameH), 1);
    const lines = wrapLines(text, family, px, weight, maxPx);
    if (lines.length <= typo.maxLines) return { size, lines };
    size = Math.round((size - step) * 10000) / 10000;
  }
  const px = Math.max(Math.round(typo.minSize * frameH), 1);
  return { size: typo.minSize, lines: wrapLines(text, family, px, weight, maxPx) };
}

function wrapForRole(text, sizeFrac, family, weight, frameW, frameH, maxWidthFrac) {
  const px = Math.max(Math.round(sizeFrac * frameH), 1);
  return wrapLines(text, family, px, weight, maxWidthFrac * frameW);
}

function advanceFrac(sizeFrac, family, weight, frameH) {
  const px = Math.max(Math.round(sizeFrac * frameH), 1);
  const { ascentPx, descentPx } = measureFontMetricsPx(family, px, weight);
  return (ascentPx + descentPx) / frameH;
}

/**
 * Compute the measured, anchored text stack. `elements` is an ORDERED list of
 * `[slot, text]` pairs already filtered to what will render, in STAGGER_ORDER.
 * Returns `{slot: {x, y, size, align, maxWidth, font, color, shadow, lines}}`
 * — every field a full TextSpec needs, so the caller no longer merges any
 * per-card styling. Mirrors `intro_card_geometry.layout` field-for-field.
 *
 * `lines` (T6640 round 3) is the ALREADY-WRAPPED text this function used to
 * reserve height for the element — `RichText` renders it verbatim instead of
 * re-deriving its own wrap, so the reserved height and the rendered height
 * can no longer disagree (design docs/plans/tasks/T6640-design.md §2 Option 1;
 * `lines` is preview-only and additive, NOT part of the `introCardGeometry.js`
 * parity contract — see design §3).
 * @param {string} composition @param {string} aspect
 * @param {[string, string][]} elements
 * @param {string} accent @param {number} frameW @param {number} frameH
 */
export function layout(composition, aspect, elements, accent, frameW, frameH) {
  const geo = geometryFor(composition, aspect);
  const { reflow, typography } = geo;
  const manifest = getFontManifest();

  const measured = [];
  let prevRole = null;
  for (const [slot, text] of elements) {
    const role = ROLE_FOR_SLOT[slot];
    const rt = typography[role];
    const family = resolveFontFamily(rt.font, manifest);
    const weight = weightFor(rt.font, manifest);
    let size;
    let lines;
    if (role === 'title') {
      ({ size, lines } = fitTitle(text, rt, family, weight, frameW, frameH, reflow.maxWidth));
    } else {
      size = rt.size;
      lines = wrapForRole(text, size, family, weight, frameW, frameH, reflow.maxWidth);
    }
    const advance = advanceFrac(size, family, weight, frameH);
    const gap = gapBetween(prevRole, role, reflow);
    measured.push({ slot, role, rt, size, lines, advance, gap });
    prevRole = role;
  }

  const total = measured.reduce((s, m) => s + m.lines.length * m.advance + m.gap, 0);
  const top = reflow.anchorMode === 'bottom' ? reflow.anchorFrac - total : reflow.anchorFrac - total / 2;

  const out = {};
  let y = top;
  for (const m of measured) {
    y += m.gap;
    const color = (m.role === 'title' || m.role === 'primary') ? accent : MUTED_COLOR;
    out[m.slot] = {
      x: reflow.anchorX, y, size: m.size, align: reflow.align, maxWidth: reflow.maxWidth,
      font: m.rt.font, color, shadow: m.rt.shadow, lines: m.lines,
    };
    y += m.lines.length * m.advance;
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
    // T6640 round 3 — the single wrap decision `layout()` already made to
    // reserve this element's height; `RichText` renders it verbatim. See
    // `layout()`'s docstring above.
    lines: pos.lines,
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

// =============================================================================
// SETTLE-AND-RECOMPUTE (T6640 round 2) — the collision-parity bug fix.
// =============================================================================
// ROOT CAUSE (confirmed live, both renderers, before this fix): `layout()`
// measures wrap width via canvas `measureText()` against the CUSTOM @font-face
// (T5180's landmine — see RichText.jsx's `measureFontMetricsPx` docstring: the
// browser returns APPROXIMATE/fallback-font metrics for some number of frames
// even after the font file has loaded). `buildPreviewElements` is a PLAIN
// function called once inline during a component's render — unlike
// `RichText.jsx`'s own text (which re-measures itself via
// `useSettledFontMetricsPx` and self-corrects), nothing EVER called
// `buildPreviewElements` again after that first, possibly-cold measurement.
// A long title's line count was decided once, while cold, and never
// revisited — so the reserved height silently stayed wrong FOREVER (not just
// during a brief cold-start window), and the next element rendered on top of
// the title's real (wider) second line. Verified: a FRESH `wrapLines()` call
// 1500ms after mount already returns the correct 2-line wrap — the algorithm
// was never the problem; the missing recompute was.
//
// Fix: mirror RichText's OWN settle pattern (poll every rAF after
// `document.fonts.ready` until measurements agree for several consecutive
// frames — STABLE_FRAMES_REQUIRED below, stricter than RichText's own
// single-repeat check; see the poll loop for why) but at the LAYOUT level —
// once settled, `setState` forces exactly one extra render with the corrected
// positions. `key` is a PRIMITIVE digest of every input that actually affects
// layout, so the effect only re-polls when something real changed (ticking a
// fact, editing the subtitle, switching aspect, OR the stage's
// ResizeObserver settling to its final measured box size), not on every
// incidental parent re-render.
// Consecutive matching poll reads required before accepting the layout as
// settled (see the poll loop below for why a single repeat under-caught a
// real case), and the hard cap so a pathological font/environment can't hang.
const STABLE_FRAMES_REQUIRED = 6;
const MAX_SETTLE_FRAMES = 45;

function elementsSignature(elements) {
  return elements.map((e) => `${e.slot}:${e.spec.position.y.toFixed(6)}:${e.spec.size.toFixed(6)}`).join('|');
}

function cacheKeyFor(card, profile, composition, aspect, frameW, frameH) {
  const facts = ['position', 'class', 'team'].map((f) => (profile && profile[f]) || '').join('|');
  return [
    card?.treatment, JSON.stringify(card?.shown_fields || []), card?.subtitle_text || '',
    profile?.full_name || '', facts, composition, aspect, frameW, frameH,
  ].join('~');
}

/**
 * Settle-aware `buildPreviewElements`: returns the current best-known layout
 * immediately (matching today's synchronous behaviour), then — once the
 * fonts actually finish settling — forces ONE corrective re-render with
 * accurate positions. Use this from components instead of calling
 * `buildPreviewElements` directly.
 */
export function useCardPreviewElements(card, profile, composition, aspect, frameW, frameH) {
  const latest = useRef(null);
  latest.current = { card, profile, composition, aspect, frameW, frameH };

  const compute = () => {
    const { card: c, profile: p, composition: comp, aspect: a, frameW: fw, frameH: fh } = latest.current;
    return buildPreviewElements(c, p, comp, a, fw, fh);
  };

  const key = cacheKeyFor(card, profile, composition, aspect, frameW, frameH);
  const [state, setState] = useState(() => ({ key, elements: compute() }));
  // T6730 audit finding F: while `state.key !== key` (the settle effect below
  // hasn't landed its corrective setState yet — e.g. IntroPreRoll's
  // ResizeObserver correcting `avail` shortly after mount), the fallback
  // below used to call `compute()` fresh on EVERY render, handing back a new
  // `elements` array identity each time even though `key` itself was not
  // changing between those renders. A consumer keyed on that identity
  // (MotionPreview's WAAPI animation-build effect) then tore down and rebuilt
  // every animation on every render for the whole settle window. Memoizing
  // per `key` returns the SAME identity across same-key renders, so a
  // downstream effect only reruns when something real actually changed.
  // `compute` (not referenced in the dep array) closes over `latest` -- a ref
  // updated above every render -- by design; adding it here would give the
  // memo a new "dependency" every render and defeat the whole fix.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const fallbackElements = useMemo(() => compute(), [key]);

  useEffect(() => {
    // jsdom (unit tests) has no FontFaceSet API — the synchronous compute
    // above (or the one below, on a key change) is as good as this gets there.
    if (typeof document === 'undefined' || !document.fonts) return undefined;
    let cancelled = false;
    let rafId;
    document.fonts.ready.then(() => {
      let matchStreak = 0;
      let previous = null;
      let frame = 0;
      const step = () => {
        if (cancelled) return;
        const current = compute();
        const sig = elementsSignature(current);
        // STABLE_FRAMES_REQUIRED consecutive IDENTICAL reads, not just one
        // repeat: right after a box RESIZE (this hook's `key` includes
        // frameW/frameH, so a ResizeObserver settling to its final measured
        // size re-triggers this effect), canvas measureText briefly plateaus
        // on a CONSISTENT-but-still-wrong value for more than one frame
        // before the true metric appears — two consecutive matches alone
        // false-positived on that plateau (confirmed live: settled after
        // exactly 2 frames on a value a fresh call moments later proved
        // wrong). Mirrors RichText's own settle poll, just with a stricter
        // streak requirement since this hook compares a WHOLE layout
        // (multiple fonts/sizes at once) rather than one element's metrics.
        matchStreak = sig === previous ? matchStreak + 1 : 0;
        if (matchStreak >= STABLE_FRAMES_REQUIRED || frame >= MAX_SETTLE_FRAMES) {
          setState({ key, elements: current });
          return;
        }
        previous = sig;
        frame += 1;
        rafId = requestAnimationFrame(step);
      };
      rafId = requestAnimationFrame(step);
    });
    return () => {
      cancelled = true;
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [key]);

  // A key change (a real prop change, e.g. toggling a fact) invalidates the
  // cached state immediately — recompute synchronously rather than flash the
  // PREVIOUS scenario's layout for one frame while waiting on the effect.
  // `fallbackElements` (memoized per `key` above) keeps that recompute's
  // identity stable across repeated renders of the SAME key.
  return state.key === key ? state.elements : fallbackElements;
}
