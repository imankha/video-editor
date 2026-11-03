import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import Guide from './Guide';
import { resolveGuide } from './resolveGuide';
import { useSettingsStore } from '../../stores/settingsStore';
import { useGuideFocusStore } from './guideFocusStore';
import { GUIDE_PULSE_CLASS } from './guideTargets';

// T14420: the Annotate play editor at 768x1024 (iPad portrait, touch strip). Geometry from the 2026-11-02 staging
// walk (r4-annotate-editor-768.png). The 26rem compact card wraps the sentence to 4 lines (416x145): it fits nowhere
// near Done (the strip under Done is about 140 px), so it docked at the top over the video, 638 px from Done. jsdom has
// no layout, so the card's size follows the width class the host carries at 768 wide: 2 lines when it spans the screen.
vi.mock('../../utils/apiFetch', () => ({ default: (...args) => fetch(...args) }));
const flush = () => act(async () => { await new Promise(r => setTimeout(r, 50)); });
const box = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top });
const W = 768, H = 1024;
const RECTS = {
  'annotate-coach-stage': box(40, 121, 687, 446),
  video: box(40, 121, 687, 386),
  'annotate-controls': box(40, 507, 687, 60),
  'scrub-track': box(150, 583, 530, 32),
  'scrub-start-handle': box(276, 583, 12, 32),
  'scrub-end-handle': box(540, 583, 12, 32),
  'rating-input': box(47, 665, 673, 115),
  'add-details-button': box(546, 780, 168, 44),
  'play-editor-done': box(53, 839, 327, 44),
  'delete-play-button': box(387, 833, 328, 52),
};
const DONE = RECTS['play-editor-done'];
/** The card at 768 wide, from the host's width classes (Tailwind: a min-[640px] width beats the base one). */
const cardAt768 = cls => {
  const wide = cls.match(/(?:^|\s)min-\[640px\]:w-\[min\(calc\(100vw-24px\),(\d+)rem\)\]/);
  if (wide) return Math.min(W - 24, Number(wide[1]) * 16) >= 640 ? { width: Math.min(W - 24, Number(wide[1]) * 16), height: 106 } : { width: 416, height: 145 };
  return { width: 416, height: 145 };
};

beforeEach(() => {
  vi.stubGlobal('innerWidth', W);
  vi.stubGlobal('innerHeight', H);
  vi.stubGlobal('requestAnimationFrame', cb => setTimeout(cb, 0));
  useSettingsStore.getState().setFromBootstrap({ guidance: { coachEnabled: true } });
  useGuideFocusStore.getState().resetAcks();
  const stage = document.createElement('div');
  stage.dataset.testid = 'annotate-coach-stage';
  const video = document.createElement('video');
  video.dataset.testid = 'video';
  stage.appendChild(video);
  document.body.appendChild(stage);
  for (const id of Object.keys(RECTS).filter(k => k !== 'annotate-coach-stage' && k !== 'video')) {
    const el = document.createElement(id === 'play-editor-done' ? 'button' : 'div');
    el.dataset.testid = id;
    if (id === 'play-editor-done') el.className = GUIDE_PULSE_CLASS;
    document.body.appendChild(el);
  }
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function rect() {
    const id = this.dataset?.testid;
    if (id === 'floating-coach-host') {
      const card = cardAt768(this.className);
      if (this.style.top) {
        const left = this.style.left ? parseFloat(this.style.left) : (W - card.width) / 2;
        return box(left, parseFloat(this.style.top), card.width, card.height);
      }
      return box((W - card.width) / 2, H - 12 - card.height, card.width, card.height);
    }
    return RECTS[id] ?? box(0, 0, 0, 0);
  });
  document.elementFromPoint = () => null;
});
afterEach(() => {
  cleanup(); vi.unstubAllGlobals(); useSettingsStore.getState().reset(); document.body.innerHTML = ''; vi.restoreAllMocks();
  delete document.elementFromPoint;
});

describe('T14420:C1 the play editor card sits next to Done at 768x1024', () => {
  it('within 250 px of Done, on screen, covering nothing the step names', async () => {
    const g = resolveGuide({ screen: 'annotate', progress: { selectedPlay: { rating: 4 }, portrait: null }, local: { editorOpen: true } });
    expect(g.id).toBe('annotate.editor');
    render(<Guide guide={g} />); await flush(); await flush();
    const hostEl = document.querySelector('[data-testid="floating-coach-host"]');
    const card = hostEl.getBoundingClientRect();
    const gap = card.top >= DONE.bottom ? card.top - DONE.bottom : DONE.top - card.bottom;
    expect(gap).toBeGreaterThanOrEqual(0);
    expect(gap).toBeLessThanOrEqual(250);
    expect(card.left).toBeGreaterThanOrEqual(0);
    expect(card.right).toBeLessThanOrEqual(W);
    expect(card.bottom).toBeLessThanOrEqual(H);
    expect(hostEl.dataset.guideOverlap).toBeUndefined();
  });
  it('the trim bar is cut out of the shade', async () => {
    const g = resolveGuide({ screen: 'annotate', progress: { selectedPlay: { rating: 4 }, portrait: null }, local: { editorOpen: true } });
    render(<Guide guide={g} />); await flush();
    const cuts = JSON.parse(document.querySelector('[data-testid="guide-shade"]').dataset.cutouts);
    const t = RECTS['scrub-track'];
    expect(cuts.some(c => c.left <= t.left && c.right >= t.right && c.top <= t.top && c.bottom >= t.bottom)).toBe(true);
  });
});
