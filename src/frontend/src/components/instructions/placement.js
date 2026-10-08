export function placeCoach(target, card, viewport, side = 'top') {
  const margin = 12;
  const left = Math.max(margin, Math.min(target.left + (target.width - card.width) / 2, viewport.width - card.width - margin));
  const preferred = side === 'bottom' ? target.bottom + margin : target.top - card.height - margin;
  const alternate = side === 'bottom' ? target.top - card.height - margin : target.bottom + margin;
  const fits = y => y >= 56 && y + card.height <= viewport.height - margin;
  // Never place the coach over its own action when neither side has room.
  // Scrolling or resizing will remeasure and reveal it once a safe space opens.
  if (!fits(preferred) && !fits(alternate)) return null;
  return { left, top: fits(preferred) ? preferred : alternate };
}


export function bandsCollide(a, b) { return a.top < b.bottom && a.bottom > b.top; }
