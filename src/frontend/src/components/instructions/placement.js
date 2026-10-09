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
  const order = viewport.width < PHONE_MAX ? ['below', 'above'] : ['right', 'below', 'left', 'above'];
  const obstacles = [t, ...avoid.map(rectOf)];
  for (const key of order) {
    const c = all[key];
    const box = { left: c.left, top: c.top, right: c.left + card.width, bottom: c.top + card.height };
    const inView = box.left >= MARGIN && box.right <= viewport.width - MARGIN && box.top >= TOP_MIN && box.bottom <= viewport.height - MARGIN;
    if (inView && !obstacles.some(o => intersects(box, o))) return { left: c.left, top: c.top };
  }
  return 'dock';
}

export const isPhoneViewport = width => width < PHONE_MAX;

export function bandsCollide(a, b) { return a.top < b.bottom && a.bottom > b.top; }
