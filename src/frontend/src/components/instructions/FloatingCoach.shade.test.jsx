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

  it('T12800: an off-screen anchor still gets a shade (the guarantee holds), but it lets scroll/click '
    + 'through -- the user is never trapped behind a shade with nothing reachable under it', async () => {
    document.body.innerHTML = '';
    place('tgt', { left: 20, top: 2000, width: 100, height: 40 });
    render(<Guide guide={guide()} />); await flush();
    expect(shade()).toBeTruthy();
    expect(shade().className).toMatch(/pointer-events-none/);
    expect(shade().dataset.scrollsThrough).toBe('true');
    expect(cutouts()).toEqual([]);
    expect(screen.getByTestId('guidance-scroll-hint')).toBeTruthy();
  });

  it('T12800: a target mostly visible at the bottom edge gets its cutout and no scroll hint on top of it', async () => {
    // Sweep 1280x800, play editor: Done at top 765 of an 800px viewport (35 of 44px visible) was called
    // off-screen, so the "Scroll down" pill docked at bottom-4 right over it and the shade left it out.
    document.body.innerHTML = '';
    vi.stubGlobal('innerHeight', 800);
    place('tgt', { left: 400, top: 765, width: 400, height: 44 });
    render(<Guide guide={guide()} />); await flush();
    expect(screen.queryByTestId('guidance-scroll-hint')).toBeNull();
    expect(shade()).toBeTruthy();
  });

  it('T12800: a target at the very top of the viewport (Home tabs at 768) gets no scroll hint over it', async () => {
    // Sweep 768x1024: the Finished tab at y 0..36 counted as under a 56px header strip, so "Scroll up" sat on the tabs.
    document.body.innerHTML = '';
    place('tgt', { left: 432, top: 0, width: 168, height: 36 });
    render(<Guide guide={guide()} />); await flush();
    expect(screen.queryByTestId('guidance-scroll-hint')).toBeNull();
    expect(shade()).toBeTruthy();
  });

  it('T12800: a target barely peeking in at the bottom edge still gets the scroll hint', async () => {
    document.body.innerHTML = '';
    vi.stubGlobal('innerHeight', 800);
    place('tgt', { left: 400, top: 790, width: 400, height: 44 });
    render(<Guide guide={guide()} />); await flush();
    expect(screen.getByTestId('guidance-scroll-hint').textContent).toMatch(/Scroll down/);
  });

  it('a display:contents anchor is measured by its children: shade on, no scroll hint', async () => {
    document.body.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.dataset.testid = 'tgt'; wrap.style.display = 'contents';
    document.body.appendChild(wrap);
    vi.spyOn(wrap, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 });
    const kid = document.createElement('button'); wrap.appendChild(kid);
    vi.spyOn(kid, 'getBoundingClientRect').mockReturnValue({ left: 200, top: 300, right: 300, bottom: 340, width: 100, height: 40 });
    render(<Guide guide={guide()} />); await flush();
    expect(shade()).toBeTruthy();
    expect(screen.queryByTestId('guidance-scroll-hint')).toBeNull();
  });

  it('T12800: a NESTED display:contents anchor (a contents wrapper whose only child is ALSO contents, e.g. '
    + 'HighlightOrientationSlots inline) is still measured by the real grandchild, not an empty union', async () => {
    // Staging 2026-10-15: annotate-highlight-slots renders `className="contents"` two levels deep when
    // `inline`. The old anchorRect only unioned DIRECT children, filtered out the zero-rect inner contents
    // div, got an empty union, and fell back to the element's own (also zero) rect -- so the shade silently
    // never rendered for the WHOLE "make a highlight" step, even though it IS focusable (a Got it button).
    document.body.innerHTML = '';
    const outer = document.createElement('div');
    outer.dataset.testid = 'tgt'; outer.style.display = 'contents';
    document.body.appendChild(outer);
    vi.spyOn(outer, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 });
    const inner = document.createElement('div');
    inner.style.display = 'contents';
    outer.appendChild(inner);
    vi.spyOn(inner, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 });
    const card = document.createElement('button');
    inner.appendChild(card);
    vi.spyOn(card, 'getBoundingClientRect').mockReturnValue({ left: 200, top: 300, right: 300, bottom: 340, width: 100, height: 40 });
    render(<Guide guide={guide()} />); await flush();
    expect(shade()).toBeTruthy();
    expect(cutouts().some(r => r.left <= 200 && r.right >= 300 && r.top <= 300 && r.bottom >= 340)).toBe(true);
  });

  it('T12800: the shade is a guarantee, not best-effort -- an anchor (and fallback) genuinely absent from '
    + 'the DOM still gets a full shade, never none, while the guide is focusable. It is pointer-events-none '
    + 'like every other fallback shade (staging 2026-10-15: this branch captured clicks across the whole '
    + 'page on an ordinary, momentarily-unsettled measurement, reading as a frozen page -- far worse than '
    + 'the missing dim it replaced; only the precise, measured cutout may ever capture pointer events)', async () => {
    document.body.innerHTML = '';
    render(<Guide guide={guide({ anchor: { target: '[data-testid="nope"]', fallback: '[data-testid="also-nope"]' } })} />);
    await flush();
    expect(shade()).toBeTruthy();
    expect(cutouts()).toEqual([]);
    expect(shade().className).toMatch(/pointer-events-none/);
  });

  it('the scroll hint says what to do, in words', async () => {
    document.body.innerHTML = '';
    place('tgt', { left: 20, top: 2000, width: 100, height: 40 });
    render(<Guide guide={guide()} />); await flush();
    expect(screen.getByTestId('guidance-scroll-hint').textContent).toMatch(/Scroll down/);
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
  it('T12630: the Play step cuts out the Play button and keeps the coach off it', () => {
    const g = resolveGuide({ screen: 'focus', local: { dragDone: true, hasPlayed: false }, progress: {} });
    expect(g.keepClear).toContain('[data-testid="play-button"]');
    expect(g.avoid).toContain('[data-testid="play-button"]');
  });
  it('T12630: a phone dock that would cover an avoided control moves to the top of the anchor', async () => {
    vi.stubGlobal('innerWidth', 390); vi.stubGlobal('innerHeight', 844);
    place('ctl', { left: 20, top: 800, width: 44, height: 44 });
    render(<Guide guide={guide({ avoid: ['[data-testid="ctl"]'] })} />); await flush();
    const host = document.querySelector('[data-testid="floating-coach-host"]');
    expect(host.dataset.docked).toBe('true');
    expect(host.style.top).not.toBe('');
    expect(host.style.bottom).toBe('');
  });
  it('mergeRects unions overlapping rects and keeps disjoint ones', () => {
    const out = mergeRects([{ left: 0, top: 0, right: 10, bottom: 10 }, { left: 5, top: 5, right: 20, bottom: 20 }, { left: 50, top: 50, right: 60, bottom: 60 }]);
    expect(out).toEqual([{ left: 0, top: 0, right: 20, bottom: 20 }, { left: 50, top: 50, right: 60, bottom: 60 }]);
  });
});
