import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, act, screen } from '@testing-library/react';
import Guide from './Guide';
import { resolveGuide } from './resolveGuide';
import { placeCoach } from './placement';
import { useSettingsStore } from '../../stores/settingsStore';
import { useGuideFocusStore } from './guideFocusStore';

/**
 * Staging 2026-10-18: the Overlay "Your highlight is ready" panel (and Focus's, and the Finished viewer) drew
 * its guide inline as a full-width bar with no shade, because those panels live in a fullscreen player layer
 * (role="dialog" aria-modal) and the floating coach stood down behind ANY open layer. A layer that holds the
 * guide's own anchor is the guide's screen, not something covering it: shade it, and put the card beside the
 * control it names.
 */
const flush = () => act(async () => { await new Promise(r => setTimeout(r, 50)); });
const shade = () => document.querySelector('[data-testid="guide-shade"]');
const host = () => document.querySelector('[data-testid="floating-coach-host"]');
const box = (el, rect) => vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({ ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height });
const layer = () => {
  const el = document.createElement('div');
  el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true');
  document.body.appendChild(el);
  return el;
};
const add = (parent, testid, rect) => {
  const el = document.createElement('button');
  el.dataset.testid = testid;
  parent.appendChild(el);
  box(el, rect);
  return el;
};
const guide = (over = {}) => ({
  id: 'r.layer', message: { title: 'Tap Finish', body: '' }, anchor: { target: '[data-testid="tgt"]', fallback: null },
  avoid: [], keepClear: [], pulse: null, tone: 'coach', step: null, phase: 'layer', ...over,
});

beforeEach(() => {
  vi.stubGlobal('innerWidth', 2000);
  vi.stubGlobal('innerHeight', 1170);
  vi.stubGlobal('requestAnimationFrame', cb => setTimeout(cb, 0));
  useSettingsStore.getState().setFromBootstrap({ guidance: { coachEnabled: true } });
  useGuideFocusStore.getState().resetAcks();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); useSettingsStore.getState().reset(); document.body.innerHTML = ''; vi.restoreAllMocks(); });

describe('a guide inside a player layer is shaded like any screen', () => {
  it('shades and shows the card when the anchor sits inside the open layer', async () => {
    add(layer(), 'tgt', { left: 620, top: 1000, width: 250, height: 150 });
    render(<Guide guide={guide()} />); await flush();
    expect(shade()).toBeTruthy();
    expect(host().style.visibility).toBe('visible');
    expect(screen.getByText('Tap Finish')).toBeTruthy();
  });

  it('still stands down behind a layer that does NOT hold its anchor (a modal opened on top)', async () => {
    add(layer(), 'tgt', { left: 620, top: 1000, width: 250, height: 150 });
    layer();
    render(<Guide guide={guide()} />); await flush();
    expect(shade()).toBeNull();
    expect(host().style.visibility).toBe('hidden');
  });
});

describe('ready panels: the card goes beside the primary card', () => {
  it('placeCoach side "beside" puts the card left of a bottom-row anchor instead of above it', () => {
    const anchor = { left: 620, top: 1000, width: 250, height: 150 };
    const pos = placeCoach(anchor, { width: 416, height: 90 }, { width: 2000, height: 1170 }, 'beside', []);
    expect(pos.left + 416).toBeLessThanOrEqual(620);
    expect(pos.top + 90).toBeGreaterThan(1000);
  });

  it.each([
    ['overlay', 'overlay-choice-primary', ['overlay-choice-reapply-overlay', 'overlay-choice-reapply-focus', 'overlay-save-draft']],
    ['focus', 'focus-choice-primary', ['focus-choice-publish', 'focus-choice-edit-framing', 'focus-save-draft']],
  ])('%s.ready anchors on the primary card, keeps the video and every CTA clear, sits beside', (scr, primary, others) => {
    const g = resolveGuide({ screen: scr, job: { status: 'ready' }, local: {} });
    expect(g.anchor.target).toBe(`[data-testid="${primary}"]`);
    expect(g.side).toBe('beside');
    for (const id of ['collection-player-video', ...others]) expect(g.keepClear).toContain(`[data-testid="${id}"]`);
  });

  it('the overlay ready card lands left of Finish, clear of the video and CTAs, with the rest shaded', async () => {
    const l = layer();
    add(l, 'collection-player-video', { left: 836, top: 183, width: 372, height: 660 });
    add(l, 'overlay-choice-primary', { left: 620, top: 1000, width: 250, height: 155 });
    add(l, 'overlay-choice-reapply-overlay', { left: 878, top: 1005, width: 174, height: 150 });
    add(l, 'overlay-choice-reapply-focus', { left: 1062, top: 1005, width: 174, height: 150 });
    add(l, 'overlay-save-draft', { left: 1246, top: 1005, width: 174, height: 150 });
    add(l, 'player-close', { left: 1960, top: 150, width: 30, height: 30 });
    const g = resolveGuide({ screen: 'overlay', job: { status: 'ready' }, local: {} });
    render(<Guide guide={g} />); await flush();
    const card = host();
    box(card, { left: 0, top: 0, width: 416, height: 90 });
    window.dispatchEvent(new Event('resize')); await flush();
    expect(card.dataset.docked).toBeUndefined();
    expect(parseFloat(card.style.left) + 416).toBeLessThanOrEqual(620);
    const cuts = JSON.parse(shade().dataset.cutouts);
    const inCut = (x, y) => cuts.some(c => c.left <= x && c.right >= x && c.top <= y && c.bottom >= y);
    expect(inCut(1000, 500)).toBe(true); // video
    expect(inCut(700, 1050)).toBe(true); // Finish
    expect(inCut(1300, 1050)).toBe(true); // Done for now
    expect(inCut(1975, 165)).toBe(false); // player chrome stays shaded
  });
});
