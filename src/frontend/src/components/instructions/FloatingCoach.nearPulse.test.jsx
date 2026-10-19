import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import Guide from './Guide';
import { useSettingsStore } from '../../stores/settingsStore';
import { useGuideFocusStore } from './guideFocusStore';
import { GUIDE_PULSE_CLASS } from './guideTargets';

// T13060: a rule anchored on a big region (Focus stage, Home heading) still puts the card next to the
// control it tells the user to press, not next to the region's centre or top.
vi.mock('../../utils/apiFetch', () => ({ default: (...args) => fetch(...args) }));
const flush = () => act(async () => { await new Promise(r => setTimeout(r, 50)); });
const full = r => ({ ...r, right: r.left + r.width, bottom: r.top + r.height, x: r.left, y: r.top });
const place = (testid, rect, cls = '') => {
  const el = document.createElement('div');
  el.dataset.testid = testid;
  el.className = cls;
  document.body.appendChild(el);
  el.getBoundingClientRect = () => full(rect);
  return el;
};
const guide = (over = {}) => ({
  id: 'focus.progress.play', message: { title: 'Tap Play and watch your athlete.', body: '' },
  anchor: { target: '[data-testid="stage"]', fallback: '[data-testid="stage"]' },
  avoid: [], keepClear: [], pulse: null, tone: 'coach', step: null, phase: 2, ...over,
});
const host = () => document.querySelector('[data-testid="floating-coach-host"]');
const CARD = { width: 416, height: 92 };

beforeEach(() => {
  vi.stubGlobal('innerWidth', 1440);
  vi.stubGlobal('innerHeight', 900);
  vi.stubGlobal('requestAnimationFrame', cb => setTimeout(cb, 0));
  const orig = Element.prototype.getBoundingClientRect;
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function () {
    return this.dataset?.testid === 'floating-coach-host' ? full({ left: 0, top: 0, ...CARD }) : orig.call(this);
  });
  useSettingsStore.getState().setFromBootstrap({ guidance: { coachEnabled: true } });
  useGuideFocusStore.getState().resetAcks();
});
afterEach(() => {
  cleanup(); vi.unstubAllGlobals(); useSettingsStore.getState().reset(); document.body.innerHTML = ''; vi.restoreAllMocks();
});

describe('card sits next to the pulsing control, not the big anchor', () => {
  it('a Play button at the foot of a tall stage gets the card beside it, not at the stage centre', async () => {
    place('stage', { left: 200, top: 80, width: 700, height: 640 });
    const play = { left: 220, top: 660, width: 32, height: 32 };
    place('play', play, GUIDE_PULSE_CLASS);
    render(<Guide guide={guide()} />); await flush();
    const top = parseFloat(host().style.top);
    const left = parseFloat(host().style.left);
    const dy = Math.abs(top + CARD.height / 2 - (play.top + play.height / 2));
    const dx = Math.abs(left + CARD.width / 2 - (play.left + play.width / 2));
    expect(Math.hypot(dx, dy)).toBeLessThan(330);
    expect(host().hasAttribute('data-guide-overlap')).toBe(false);
  });

  it('a heading anchor with the pulsing tile at the bottom puts the card above the tile, not at the top of the page', async () => {
    place('stage', { left: 200, top: 60, width: 700, height: 40 });
    const tile = { left: 200, top: 780, width: 220, height: 80 };
    place('tile', tile, GUIDE_PULSE_CLASS);
    render(<Guide guide={guide()} />); await flush();
    const top = parseFloat(host().style.top);
    expect(top + CARD.height).toBeLessThanOrEqual(tile.top);
    expect(tile.top - (top + CARD.height)).toBeLessThanOrEqual(24);
  });
});
