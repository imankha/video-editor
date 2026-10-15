import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import Guide from './Guide';
import { useSettingsStore } from '../../stores/settingsStore';
import { useGuideFocusStore } from './guideFocusStore';
import { GUIDE_PULSE_CLASS } from './guideTargets';

// T12800 layer 1: the runtime oracle. The host carries data-guide-overlap="<names>" whenever the
// final card position still covers a pulsing control or a keepClear rect; clear placements have none.
vi.mock('../../utils/apiFetch', () => ({ default: (...args) => fetch(...args) }));
const flush = () => act(async () => { await new Promise(r => setTimeout(r, 50)); });
const CARD_H = 92;
const full = r => ({ ...r, right: r.left + r.width, bottom: r.top + r.height, x: r.left, y: r.top });
const place = (testid, rect, cls = '') => {
  const el = document.createElement('button');
  el.dataset.testid = testid;
  el.className = cls;
  document.body.appendChild(el);
  el.getBoundingClientRect = () => full(rect);
  return el;
};
const guide = (over = {}) => ({
  id: 'annotate.editor', message: { title: 'Tap Done.', body: '' },
  anchor: { target: '[data-testid="tgt"]', fallback: '[data-testid="tgt"]' },
  avoid: [], keepClear: [], pulse: null, tone: 'coach', step: null, phase: 'editor', ...over,
});
const host = () => document.querySelector('[data-testid="floating-coach-host"]');

beforeEach(() => {
  vi.stubGlobal('innerWidth', 500); // phone: the card always docks
  vi.stubGlobal('innerHeight', 900);
  vi.stubGlobal('requestAnimationFrame', cb => setTimeout(cb, 0));
  const orig = Element.prototype.getBoundingClientRect;
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function () {
    return this.dataset?.testid === 'floating-coach-host' ? full({ left: 12, top: 0, width: innerWidth - 24, height: CARD_H }) : orig.call(this);
  });
  useSettingsStore.getState().setFromBootstrap({ guidance: { coachEnabled: true } });
  useGuideFocusStore.getState().resetAcks();
});
afterEach(() => {
  cleanup(); vi.unstubAllGlobals(); useSettingsStore.getState().reset(); document.body.innerHTML = ''; vi.restoreAllMocks();
});

describe('data-guide-overlap oracle', () => {
  it('is absent when the card is clear of every pulsing control', async () => {
    place('tgt', { left: 200, top: 300, width: 100, height: 40 });
    place('other-pulse', { left: 100, top: 100, width: 100, height: 40 }, GUIDE_PULSE_CLASS);
    render(<Guide guide={guide()} />); await flush();
    expect(host().hasAttribute('data-guide-overlap')).toBe(false);
  });

  it('names what the card covers when every slot is blocked, and warns once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    place('tgt', { left: 200, top: 300, width: 100, height: 40 });
    // Pulsing controls in the bottom dock strip, directly above the anchor, and the top strip: no slot is clear.
    place('pulse-bottom', { left: 20, top: 780, width: 200, height: 40 }, GUIDE_PULSE_CLASS);
    place('pulse-mid', { left: 20, top: 200, width: 200, height: 60 }, GUIDE_PULSE_CLASS);
    place('pulse-top', { left: 20, top: 60, width: 200, height: 40 }, GUIDE_PULSE_CLASS);
    render(<Guide guide={guide()} />); await flush();
    const names = host().dataset.guideOverlap.split(',');
    expect(names.length).toBeGreaterThan(0);
    expect(names.every(n => ['pulse-bottom', 'pulse-mid', 'pulse-top'].includes(n))).toBe(true);
    const calls = warn.mock.calls.filter(c => c[0] === '[guide-overlap]');
    expect(calls.length).toBe(1);
    expect(calls[0][1]).toBe('annotate.editor');
  });
});
