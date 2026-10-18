const MARGIN = 12;
const TOP_MIN = 56;
const PHONE_MAX = 640;

const rectOf = r => ({ left: r.left, top: r.top, right: r.right ?? r.left + r.width, bottom: r.bottom ?? r.top + r.height });
const intersects = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

/**
 * Pick a spot for the coach card next to `target`, or 'dock' when nothing fits.
 * Candidates: right, below, left, above on desktop; below, above on phones.
 * A candidate is rejected if it leaves the viewport or intersects the anchor
 * or any avoid rect. `side: 'beside'` tries left, then right first (a card naming one card in a row of CTAs);
 * any other side keeps the fixed order.
 */
export function placeCoach(target, card, viewport, side = 'top', avoid = []) {
  const t = rectOf(target);
  const clampX = x => Math.max(MARGIN, Math.min(x, viewport.width - card.width - MARGIN));
  const clampY = y => Math.max(TOP_MIN, Math.min(y, viewport.height - card.height - MARGIN));
  const centerX = clampX(t.left + (t.right - t.left - card.width) / 2);
  const centerY = clampY(t.top + (t.bottom - t.top - card.height) / 2);
  const all = {
    right: { left: t.right + MARGIN, top: centerY },
    below: { left: centerX, top: t.bottom + MARGIN },
    left: { left: t.left - card.width - MARGIN, top: centerY },
    above: { left: centerX, top: t.top - card.height - MARGIN },
  };
  // T12650: an item in the bottom (top) quarter gets the card on the vertical side facing the screen centre.
  const mid = (t.top + t.bottom) / 2;
  const order = viewport.width < PHONE_MAX
    ? ['below', 'above']
    : side === 'beside' ? ['left', 'right', 'above', 'below']
    : mid > viewport.height * 0.75 ? ['above', 'right', 'left', 'below']
      : mid < viewport.height * 0.25 ? ['below', 'right', 'left', 'above']
        : ['right', 'below', 'left', 'above'];
  const obstacles = [t, ...avoid.map(rectOf)];
  for (const key of order) {
    const c = all[key];
    const box = { left: c.left, top: c.top, right: c.left + card.width, bottom: c.top + card.height };
    const inView = box.left >= MARGIN && box.right <= viewport.width - MARGIN && box.top >= TOP_MIN && box.bottom <= viewport.height - MARGIN;
    if (inView && !obstacles.some(o => intersects(box, o))) return { left: c.left, top: c.top };
  }
  return 'dock';
}

/**
 * T12650: where a docked card goes. Default is the bottom strip ('dock'); if that strip would sit
 * on the anchor (or a keep-clear rect), the card moves to the top, hugging the anchor from above.
 * Returns 'dock' when the bottom strip is clear, a { left, top, dockTop } when moved, or 'dock'
 * again when no top slot is clear either (the bottom strip then stays, covering least).
 */
export function dockPlacement(anchor, cardHeight, viewport, bottomOffset, keepOut = []) {
  const obstacles = [anchor, ...keepOut].map(rectOf);
  const slot = (top) => ({ left: 0, right: viewport.width, top, bottom: top + cardHeight });
  if (!obstacles.some(o => intersects(slot(viewport.height - bottomOffset - cardHeight), o))) return 'dock';
  const a = rectOf(anchor);
  for (const top of [a.top - cardHeight - 8, TOP_MIN]) {
    if (top >= TOP_MIN && !obstacles.some(o => intersects(slot(top), o))) return { left: MARGIN, top: Math.round(top), dockTop: true };
  }
  return 'dock';
}

export const isPhoneViewport = width => width < PHONE_MAX;

export function bandsCollide(a, b) { return a.top < b.bottom && a.bottom > b.top; }

/** T12580: union intersecting rects so a single even-odd path can cut each hole once. */
export function mergeRects(rects) {
  const out = rects.map(rectOf);
  for (let i = 0; i < out.length; i++) {
    for (let j = i + 1; j < out.length; j++) {
      if (!intersects(out[i], out[j])) continue;
      const a = out[i], b = out[j];
      out[i] = { left: Math.min(a.left, b.left), top: Math.min(a.top, b.top), right: Math.max(a.right, b.right), bottom: Math.max(a.bottom, b.bottom) };
      out.splice(j, 1);
      i = -1; break;
    }
  }
  return out;
}

/** T12580: clip-path that covers the viewport except the (merged) holes. clip-path clips hit-testing, so holes pass clicks through. */
export function shadeClipPath(viewport, holes) {
  const hole = h => `M${h.left} ${h.top}H${h.right}V${h.bottom}H${h.left}Z`;
  return `path(evenodd, "M0 0H${viewport.width}V${viewport.height}H0Z${holes.map(hole).join('')}")`;
}

/** The box a resolved coach position occupies: 'dock' (bottom strip), a { top, dockTop } strip, or a floating { left, top } card. */
export function coachBox(pos, card, viewport, bottomOffset) {
  if (pos === 'dock') return { left: 0, right: viewport.width, top: viewport.height - bottomOffset - card.height, bottom: viewport.height - bottomOffset };
  if (pos.dockTop) return { left: 0, right: viewport.width, top: pos.top, bottom: pos.top + card.height };
  return { left: pos.left, top: pos.top, right: pos.left + card.width, bottom: pos.top + card.height };
}

const SCAN_STEP = 16;
const range = (from, to) => { const out = []; for (let v = from; v <= to; v += SCAN_STEP) out.push(Math.round(v)); return out; };

/**
 * The card never sits on what the step tells the user to touch (pulsing controls, keep-clear rects).
 * Keeps `next` when it is clear; else the bottom dock, a strip just above the anchor, then the top strip.
 * T12800: when all of those cover one, scan the viewport (full-width strips; on wider screens floating
 * cards too) and take the clear slot nearest the anchor. Only when nothing anywhere is clear does `next`
 * stand, and the oracle (`coveredTargets`) then names what it covers.
 * `floatFirst` (side 'beside'): skip the full-width strips and take the nearest floating slot first, so a
 * card that can't fit exactly beside its anchor still lands next to it rather than at the top of the screen.
 */
export function clearOfPulses(next, { anchor, card, viewport, bottomOffset, keepOut, floatFirst = false }) {
  if (!keepOut.length) return next;
  const a = rectOf(anchor);
  const obstacles = keepOut.map(rectOf);
  const isClear = p => !obstacles.some(r => intersects(coachBox(p, card, viewport, bottomOffset), r));
  const strip = t => ({ left: MARGIN, top: Math.round(t), dockTop: true });
  const tops = range(TOP_MIN, viewport.height - card.height - MARGIN);
  const floats = isPhoneViewport(viewport.width) ? [] : tops.flatMap(top => range(MARGIN, viewport.width - card.width - MARGIN).map(left => ({ left, top })));
  const ax = (a.left + a.right) / 2, ay = (a.top + a.bottom) / 2;
  const distance = p => { const b = coachBox(p, card, viewport, bottomOffset); return Math.hypot((b.left + b.right) / 2 - ax, (b.top + b.bottom) / 2 - ay); };
  const nearest = slots => { const ok = slots.filter(isClear); return ok.length ? ok.reduce((best, p) => distance(p) < distance(best) ? p : best) : null; };
  if (floatFirst && isClear(next)) return next;
  const nearFloat = floatFirst ? nearest(floats) : null;
  if (nearFloat) return nearFloat;
  const preferred = [next, 'dock', ...[a.top - card.height - 8, TOP_MIN].filter(t => t >= TOP_MIN).map(strip)];
  const clear = preferred.find(isClear);
  if (clear) return clear;
  return nearest([...floats, ...tops.map(strip)]) ?? next;
}

/**
 * T12800: the names of the touch targets (`{ name, rect }`) the resolved card position covers.
 * The runtime oracle behind `data-guide-overlap`: empty means the card is clear of every one.
 */
export function coveredTargets(pos, card, viewport, bottomOffset, targets) {
  const box = coachBox(pos, card, viewport, bottomOffset);
  return targets.filter(t => intersects(box, rectOf(t.rect))).map(t => t.name);
}

/** Width of a card shown beside a dialog (px); the fit test needs it before the card is measured. */
export const BESIDE_CARD_WIDTH = 336;

/**
 * A dialog's guide card goes OFF TO THE SIDE of the dialog (right, then left), level with the
 * control it names, so it never sits on or inside that control. Returns `{ left, top, side }`,
 * or null when neither side has room (a phone), where the caller keeps the card inline.
 */
export function placeBeside(panel, anchor, card, viewport) {
  const p = rectOf(panel), a = rectOf(anchor);
  const width = card.width ?? BESIDE_CARD_WIDTH;
  const top = Math.max(TOP_MIN, Math.min(a.top, viewport.height - (card.height ?? 0) - MARGIN));
  const right = p.right + MARGIN;
  if (right + width <= viewport.width - MARGIN) return { left: right, top, side: 'right' };
  const left = p.left - MARGIN - width;
  if (left >= MARGIN) return { left, top, side: 'left' };
  return null;
}
