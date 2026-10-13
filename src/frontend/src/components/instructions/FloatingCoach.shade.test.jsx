import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, act, screen, fireEvent } from '@testing-library/react';
import Guide from './Guide';
import InstructionCoach from './InstructionCoach';
import { resolveGuide } from './resolveGuide';
import { mergeRects } from './placement';
import { useSettingsStore } from '../../stores/settingsStore';
import { useAuthStore } from '../../stores/authStore';
import { useGuideFocusStore } from './guideFocusStore';

vi.mock('../../utils/apiFetch', () => ({ default: (...args) => fetch(...args) }));
const flush = () => act(async () => { await new Promise(r => setTimeout(r, 50)); });
const shade = () => document.querySelector('[data-testid="guide-shade"]');
const cutouts = () => JSON.parse(shade().dataset.cutouts);
const place = (testid, rect) => {
  const el = document.createElement('button');
  el.dataset.testid = testid;
  document.body.appendChild(el);
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({ ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height });
  return el;
};
const guide = (over = {}) => ({
  id: 'r.one', message: { title: 'Do the thing', body: '' }, anchor: { target: '[data-testid="tgt"]', fallback: '[data-testid="tgt"]' },
  avoid: [], keepClear: [], pulse: null, tone: 'coach', step: null, phase: 'one', ...over,
});
const tgtRect = { left: 200, top: 300, width: 100, height: 40 };

beforeEach(() => {
  vi.stubGlobal('innerWidth', 1440);
  vi.stubGlobal('innerHeight', 900);
  vi.stubGlobal('requestAnimationFrame', cb => setTimeout(cb, 0));
  useSettingsStore.getState().setFromBootstrap({ guidance: { coachEnabled: true } });
  useGuideFocusStore.getState().resetAcks();
  place('tgt', tgtRect);
});
afterEach(() => {
  cleanup(); vi.unstubAllGlobals(); useSettingsStore.getState().reset(); document.body.innerHTML = ''; vi.restoreAllMocks();
});

describe('T12580: every guide step opens Focused', () => {
  it('shows dialog, Got it, and a shade whose cutout is the anchor', async () => {
    render(<Guide guide={guide()} />); await flush();
    expect(screen.getByText('Do the thing')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Got it' })).toBeTruthy();
    expect(shade()).toBeTruthy();
    const [c] = cutouts();
    expect(c.left).toBeLessThanOrEqual(200); expect(c.right).toBeGreaterThanOrEqual(300);
    expect(c.top).toBeLessThanOrEqual(300); expect(c.bottom).toBeGreaterThanOrEqual(340);
    expect(shade().className).toMatch(/backdrop-blur/);
    expect(document.querySelector('[role="status"]').getAttribute('aria-modal')).toBeNull();
  });

  it('Got it clears shade and dialog, stays free for the same rule, re-opens for the next rule', async () => {
    const { rerender } = render(<Guide guide={guide()} />); await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Got it' })); await flush();
    expect(shade()).toBeNull();
    expect(screen.queryByText('Do the thing')).toBeNull();
    rerender(<Guide guide={guide({ phase: 'one-b' })} />); await flush();
    expect(shade()).toBeNull();
    rerender(<Guide guide={guide({ id: 'r.two', phase: 'two', message: { title: 'Next thing', body: '' } })} />); await flush();
    expect(shade()).toBeTruthy();
    expect(screen.getByText('Next thing')).toBeTruthy();
  });

  it('Esc acknowledges; a tap on the shade does nothing', async () => {
    render(<Guide guide={guide()} />); await flush();
    fireEvent.click(shade()); await flush();
    expect(shade()).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' }); await flush();
    expect(shade()).toBeNull();
  });

  it('guidance off renders nothing', async () => {
    useSettingsStore.getState().setFromBootstrap({ guidance: { coachEnabled: false } });
    render(<Guide guide={guide()} />); await flush();
    expect(shade()).toBeNull();
    expect(screen.queryByText('Do the thing')).toBeNull();
  });

  it('turning guidance on again resets acknowledgements', async () => {
    useAuthStore.setState({ isAuthenticated: true });
    vi.stubGlobal('fetch', vi.fn(async (_u, o) => ({ ok: true, json: async () => JSON.parse(o.body) })));
    render(<Guide guide={guide()} />); await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Got it' })); await flush();
    await act(async () => { await useSettingsStore.getState().setCoachEnabled(false); });
    await act(async () => { await useSettingsStore.getState().setCoachEnabled(true); });
    await flush();
    expect(shade()).toBeTruthy();
  });

  it('progress and error steps are dialog only, no shade and no Got it', async () => {
    for (const tone of ['progress', 'error']) {
      const { unmount } = render(<Guide guide={guide({ tone })} />); await flush();
      expect(screen.getByText('Do the thing')).toBeTruthy();
      expect(shade()).toBeNull();
      expect(screen.queryByRole('button', { name: 'Got it' })).toBeNull();
      unmount();
    }
  });

  it('keepClear and the Guidance switch join the cutout', async () => {
    place('stage', { left: 600, top: 100, width: 400, height: 300 });
    place('guidance-toggle', { left: 1300, top: 10, width: 100, height: 44 });
    render(<Guide guide={guide({ keepClear: ['[data-testid="stage"]'] })} />); await flush();
    const rects = cutouts();
    expect(rects.some(r => r.left <= 600 && r.right >= 1000 && r.top <= 100 && r.bottom >= 400)).toBe(true);
    expect(rects.some(r => r.left <= 1300 && r.right >= 1400 && r.top <= 10)).toBe(true);
  });

  it('an off-screen anchor skips the shade so the user is never trapped', async () => {
    document.body.innerHTML = '';
    place('tgt', { left: 20, top: 2000, width: 100, height: 40 });
    render(<Guide guide={guide()} />); await flush();
    expect(shade()).toBeNull();
    expect(screen.getByTestId('guidance-scroll-hint')).toBeTruthy();
  });

  it('persists nothing', async () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    render(<Guide guide={guide()} />); await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Got it' })); await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
  });

  it('InstructionCoach outside a floating host has no Got it', () => {
    render(<InstructionCoach>Inline</InstructionCoach>);
    expect(screen.queryByRole('button', { name: 'Got it' })).toBeNull();
  });
});

describe('T12580: rules', () => {
  it('watch steps keep the video stage clear', () => {
    const f = (screen, local, job) => resolveGuide({ screen, local, job, progress: {} });
    expect(f('annotate', {}).keepClear.length).toBeGreaterThan(0);
    expect(f('annotate', { isPlaying: true }).keepClear.length).toBeGreaterThan(0);
    expect(f('focus', { dragDone: true, hasPlayed: false }).keepClear.length).toBeGreaterThan(0);
    expect(f('focus', { dragDone: true, hasPlayed: true, hasPlayedThrough: true, previewing: true, hasPreviewPlayedThrough: false }).keepClear.length).toBeGreaterThan(0);
    expect(f('focus', { dragDone: false }).keepClear).toEqual([]);
  });
  it('mergeRects unions overlapping rects and keeps disjoint ones', () => {
    const out = mergeRects([{ left: 0, top: 0, right: 10, bottom: 10 }, { left: 5, top: 5, right: 20, bottom: 20 }, { left: 50, top: 50, right: 60, bottom: 60 }]);
    expect(out).toEqual([{ left: 0, top: 0, right: 20, bottom: 20 }, { left: 50, top: 50, right: 60, bottom: 60 }]);
  });
});
