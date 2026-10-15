import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import Guide from './Guide';
import { useSettingsStore } from '../../stores/settingsStore';
import { useGuideFocusStore } from './guideFocusStore';
import { GUIDE_PULSE_CLASS } from './guideTargets';

// Staging 2026-10-14: the play editor's guide docked ON the pulsing Done button. The bottom
// dock collided with an avoid rect (Delete play, beside Done), and the fallback put the card
// at anchor.top + 8, i.e. on top of the anchor. A pulsing control must never be under the card.
vi.mock('../../utils/apiFetch', () => ({ default: (...args) => fetch(...args) }));
const flush = () => act(async () => { await new Promise(r => setTimeout(r, 50)); });
const CARD_H = 92;
// Docked: full width minus the 12px insets; floating: w-[26rem].
const cardWidth = host => host.dataset.docked ? innerWidth - 24 : 416;
const full = r => ({ ...r, right: r.left + r.width, bottom: r.top + r.height, x: r.left, y: r.top });
const place = (testid, rect, cls = '') => {
  const el = document.createElement('button');
  el.dataset.testid = testid;
  el.className = cls;
  document.body.appendChild(el);
  el.getBoundingClientRect = () => full(rect); // own property: the prototype spy below stays shared
  return el;
};
const guide = (over = {}) => ({
  id: 'annotate.editor', message: { title: 'Drag the green ends, then tap Done.', body: '' },
  anchor: { target: '[data-testid="play-editor-done"]', fallback: '[data-testid="play-editor-done"]' },
  avoid: ['[data-testid="delete-play-button"]'], keepClear: [], pulse: null, tone: 'coach', step: null, phase: 'editor', ...over,
});
const cardBox = () => {
  const host = document.querySelector('[data-testid="floating-coach-host"]');
  const top = host.style.top ? parseFloat(host.style.top) : innerHeight - parseFloat(host.style.bottom) - CARD_H;
  const left = host.dataset.docked ? 12 : parseFloat(host.style.left);
  return { left, right: left + cardWidth(host), top, bottom: top + CARD_H };
};
const overlaps = (box, r) => box.top < r.top + r.height && box.bottom > r.top && box.left < r.left + r.width && box.right > r.left;

beforeEach(() => {
  vi.stubGlobal('innerWidth', 1579);
  vi.stubGlobal('innerHeight', 1103);
  vi.stubGlobal('requestAnimationFrame', cb => setTimeout(cb, 0));
  const orig = Element.prototype.getBoundingClientRect;
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function () {
    return this.dataset?.testid === 'floating-coach-host' ? full({ left: 12, top: 0, width: cardWidth(this), height: CARD_H }) : orig.call(this);
  });
  useSettingsStore.getState().setFromBootstrap({ guidance: { coachEnabled: true } });
  useGuideFocusStore.getState().resetAcks();
});
afterEach(() => {
  cleanup(); vi.unstubAllGlobals(); useSettingsStore.getState().reset(); document.body.innerHTML = ''; vi.restoreAllMocks();
});

describe('the guide card never covers a pulsing control', () => {
  it('play editor: Done at the bottom with Delete play beside it (the dock collides with Delete play)', async () => {
    vi.stubGlobal('innerWidth', 500); // phone: always docks, the branch the staging screenshot took
    const done = { left: 16, top: 988, width: 230, height: 40 };
    place('play-editor-done', done, GUIDE_PULSE_CLASS);
    place('delete-play-button', { left: 254, top: 988, width: 230, height: 40 });
    render(<Guide guide={guide()} />); await flush();
    expect(overlaps(cardBox(), done)).toBe(false);
  });

  it('a pulsing control that is not the anchor is not docked over and is cut out of the shade', async () => {
    place('tgt', { left: 200, top: 300, width: 100, height: 40 });
    const other = { left: 100, top: 1030, width: 200, height: 44 };
    place('other-pulse', other, GUIDE_PULSE_CLASS);
    vi.stubGlobal('innerWidth', 500); // phone: always docks
    render(<Guide guide={guide({ anchor: { target: '[data-testid="tgt"]', fallback: '[data-testid="tgt"]' }, avoid: [] })} />); await flush();
    expect(overlaps(cardBox(), other)).toBe(false);
    const cuts = JSON.parse(document.querySelector('[data-testid="guide-shade"]').dataset.cutouts);
    expect(cuts.some(c => c.left <= other.left && c.right >= other.left + other.width && c.top <= other.top && c.bottom >= other.top + other.height)).toBe(true);
  });

  it('desktop play editor: the card covers neither Done nor what the step keeps clear (rater, trim handles)', async () => {
    vi.stubGlobal('innerWidth', 1287);
    vi.stubGlobal('innerHeight', 865);
    const done = { left: 150, top: 782, width: 575, height: 36 };
    const rating = { left: 131, top: 607, width: 1156, height: 113 };
    const handles = [{ left: 428, top: 520, width: 22, height: 46 }, { left: 1004, top: 520, width: 22, height: 46 }];
    place('play-editor-done', done, GUIDE_PULSE_CLASS);
    place('delete-play-button', { left: 735, top: 782, width: 552, height: 36 });
    place('rating-input', rating);
    place('scrub-start-handle', handles[0]);
    place('scrub-end-handle', handles[1]);
    render(<Guide guide={guide({ keepClear: ['[data-testid="scrub-start-handle"]', '[data-testid="scrub-end-handle"]', '[data-testid="rating-input"]'] })} />); await flush();
    for (const r of [done, rating, ...handles]) expect(overlaps(cardBox(), r), JSON.stringify(r)).toBe(false);
  });
});
