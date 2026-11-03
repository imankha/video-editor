import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import Guide from './Guide';
import { resolveGuide, GUIDE_STATES } from './resolveGuide';
import { homeFacts } from './catalog';
import { useSettingsStore } from '../../stores/settingsStore';
import { useGuideFocusStore } from './guideFocusStore';
import { GUIDE_PULSE_CLASS } from './guideTargets';

// T14440: the guided highlight slot / first draft tile opened with its lower part under the fold while the card sat
// next to it (staging 2026-11-02: Home Clips first draft tile y 518 to 817 at 1024x768, y 653 to 930 at 390x844).
// The step must scroll its target fully on-screen when it opens, once, with the card still within 250 px and off it.
vi.mock('../../utils/apiFetch', () => ({ default: (...args) => fetch(...args) }));
const flush = () => act(async () => { await new Promise(r => setTimeout(r, 50)); });
const box = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top });
const CARD = { width: 366, height: 120 };

let scroller;
let tileAt; // the tile's rect at scrollTop 0
const mount = ({ width, height, tile }) => {
  vi.stubGlobal('innerWidth', width);
  vi.stubGlobal('innerHeight', height);
  tileAt = tile;
  // The page scroller (App's `flex-1 overflow-auto` wrapper) holding the Clips gallery.
  scroller = document.createElement('div');
  scroller.className = 'flex-1 overflow-auto';
  scroller.style.overflowY = 'auto';
  scroller.dataset.testid = 'page';
  let top = 0;
  Object.defineProperty(scroller, 'scrollTop', { configurable: true, get: () => top, set: (v) => { top = Math.max(0, Math.min(v, 2000 - height)); } });
  Object.defineProperty(scroller, 'scrollHeight', { configurable: true, get: () => 2000 });
  Object.defineProperty(scroller, 'clientHeight', { configurable: true, get: () => height });
  scroller.scrollBy = vi.fn(({ top: dy }) => { scroller.scrollTop = top + dy; scroller.dispatchEvent(new Event('scroll')); });
  const heading = document.createElement('h2');
  heading.dataset.testid = 'home-heading';
  const tileEl = document.createElement('div');
  tileEl.dataset.testid = 'home-first-clip';
  tileEl.className = GUIDE_PULSE_CLASS;
  scroller.append(heading, tileEl);
  document.body.appendChild(scroller);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function rect() {
    const id = this.dataset?.testid;
    const dy = scroller.scrollTop;
    if (id === 'page') return box(0, 0, width, height);
    if (id === 'home-heading') return box(16, 120 - dy, width - 32, 32);
    if (id === 'home-first-clip') return box(tileAt.left, tileAt.top - dy, tileAt.width, tileAt.height);
    if (id === 'floating-coach-host') {
      const s = this.style;
      const top = s.top ? parseFloat(s.top) : height - (s.bottom ? parseFloat(s.bottom) : 12) - CARD.height;
      const left = s.left ? parseFloat(s.left) : (width - CARD.width) / 2;
      return box(left, top, CARD.width, CARD.height);
    }
    return box(0, 0, 0, 0);
  });
};
const tileRect = () => document.querySelector('[data-testid="home-first-clip"]').getBoundingClientRect();
const hostRect = () => document.querySelector('[data-testid="floating-coach-host"]').getBoundingClientRect();
const gap = (a, b) => Math.max(0, a.left - b.right, b.left - a.right, a.top - b.bottom, b.top - a.bottom);
const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
const clipsGuide = () => resolveGuide(homeFacts({ tab: 'clips', modal: null, games: 1, gamesWithPlays: 1, uploading: 0, failed: 0, drafts: 2, finished: 0 }));

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', cb => setTimeout(cb, 0));
  useSettingsStore.getState().setFromBootstrap({ guidance: { coachEnabled: true } });
  useGuideFocusStore.getState().resetAcks();
});
afterEach(() => {
  cleanup(); vi.unstubAllGlobals(); useSettingsStore.getState().reset(); document.body.innerHTML = ''; vi.restoreAllMocks();
});

describe('T14440:C1 the guided target is fully on-screen when its step opens', () => {
  it.each([
    ['1024x768', { width: 1024, height: 768, tile: box(260, 518, 240, 299) }],
    ['390x844', { width: 390, height: 844, tile: box(16, 653, 358, 277) }],
  ])('Home Clips first draft tile at %s', async (_n, geometry) => {
    mount(geometry);
    const g = clipsGuide();
    expect(g.id).toBe('home.clips.unfinished');
    render(<Guide guide={g} />); await flush();
    const tile = tileRect();
    expect(tile.top).toBeGreaterThanOrEqual(0);
    expect(tile.bottom).toBeLessThanOrEqual(geometry.height);
    const host = hostRect();
    expect(overlaps(host, tile)).toBe(false);
    expect(gap(host, tile)).toBeLessThanOrEqual(250);
  });

  it('scrolls once per step: scrolling back up afterwards is left alone', async () => {
    mount({ width: 1024, height: 768, tile: box(260, 518, 240, 299) });
    render(<Guide guide={clipsGuide()} />); await flush();
    expect(scroller.scrollBy).toHaveBeenCalledTimes(1);
    act(() => { scroller.scrollTop = 0; scroller.dispatchEvent(new Event('scroll')); });
    await flush();
    expect(scroller.scrollBy).toHaveBeenCalledTimes(1);
    expect(scroller.scrollTop).toBe(0);
  });

  it('a step that does not ask to reveal its target never scrolls the page', async () => {
    mount({ width: 1024, height: 768, tile: box(260, 518, 240, 299) });
    render(<Guide guide={{ ...clipsGuide(), id: 'other', reveal: false }} />); await flush();
    expect(scroller.scrollBy).not.toHaveBeenCalled();
  });
});

describe('T14440:C2 the steps from the staging table ask to reveal their target', () => {
  const byId = id => resolveGuide(GUIDE_STATES.find(s => s.expectId === id).facts);
  it.each(['annotate.progress.portrait', 'annotate.progress.brilliant', 'annotate.selected.none'])('%s', id => {
    expect(byId(id).reveal).toBe(true);
  });
  it('home.clips.unfinished', () => expect(clipsGuide().reveal).toBe(true));
  it('the watch step (Mark play below the fold is a scroll pill, not a jump) does not', () => {
    expect(byId('annotate.progress.watch').reveal).toBeFalsy();
  });
});
