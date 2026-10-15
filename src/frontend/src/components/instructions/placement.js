const MARGIN = 12;
const TOP_MIN = 56;
const PHONE_MAX = 640;

const rectOf = r => ({ left: r.left, top: r.top, right: r.right ?? r.left + r.width, bottom: r.bottom ?? r.top + r.height });
const intersects = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

/**
 * Pick a spot for the coach card next to `target`, or 'dock' when nothing fits.
 * Candidates: right, below, left, above on desktop; below, above on phones.
 * A candidate is rejected if it leaves the viewport or intersects the anchor
 * or any avoid rect. `side` is kept for call-site compatibility; order is fixed.
 */
export function placeCoach(target, card, viewport, _side = 'top', avoid = []) {
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

/**
 * The card never sits on a pulsing control (the one thing the sentence tells the user to press).
 * Keeps `next` when it is clear; else the bottom dock, a strip just above the anchor, then the top strip.
 * When every slot covers a pulse, `next` stands.
 */
export function clearOfPulses(next, { anchor, card, viewport, bottomOffset, pulses }) {
  if (!pulses.length) return next;
  const a = rectOf(anchor);
  const candidates = [next, 'dock', ...[a.top - card.height - 8, TOP_MIN].filter(t => t >= TOP_MIN).map(t => ({ left: MARGIN, top: Math.round(t), dockTop: true }))];
  const clear = candidates.find(p => !pulses.map(rectOf).some(r => intersects(coachBox(p, card, viewport, bottomOffset), r)));
  return clear ?? next;
}
