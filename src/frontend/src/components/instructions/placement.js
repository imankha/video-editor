export function placeCoach(target, card, viewport, side = 'top') {
  const margin = 12;
  const left = Math.max(margin, Math.min(target.left + (target.width - card.width) / 2, viewport.width - card.width - margin));
  const preferred = side === 'bottom' ? target.bottom + margin : target.top - card.height - margin;
  const alternate = side === 'bottom' ? target.top - card.height - margin : target.bottom + margin;
  const fits = y => y >= 56 && y + card.height <= viewport.height - margin;
  return { left, top: Math.max(56, Math.min(fits(preferred) ? preferred : fits(alternate) ? alternate : target.top + margin, viewport.height - card.height - margin)) };
}


export function bandsCollide(a, b) { return a.top < b.bottom && a.bottom > b.top; }
