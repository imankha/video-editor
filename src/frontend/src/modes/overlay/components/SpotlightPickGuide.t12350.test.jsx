import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import SpotlightPickGuide from './SpotlightPickGuide';
import { GUIDE } from '../../../config/displayNames';
import { resolvePickGuide } from '../../../components/instructions/resolveGuide';
import { useSettingsStore } from '../../../stores/settingsStore';
// T13420: guidance reads Off until settings load; these tests exercise a loaded, guidance-On profile.
beforeEach(() => { useSettingsStore.getState().setFromBootstrap({ guidance: { coachEnabled: true } }); });

// T12350: one classifier. The pick guide component and the box pulse both ask the
// resolver which state the walk is in; the component no longer re-derives it from phase
// and a private hint flag.
describe('SpotlightPickGuide T12350: state comes from the resolver', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))); });
  afterEach(() => { vi.unstubAllGlobals(); });

  const CASES = [
    ['first moment', { phase: 'parked', step: 1, total: 4, assignedCount: 0, boxed: true }, 'overlay.pick.first'],
    ['just tapped', { phase: 'confirm', step: 1, total: 4, assignedCount: 1, boxed: true }, 'overlay.pick.next'],
    ['back at a later moment', { phase: 'parked', step: 2, total: 4, assignedCount: 1, boxed: true }, 'overlay.pick.at-marker'],
    ['scrubbed away', { phase: 'away', step: 2, total: 4, assignedCount: 1, boxed: true }, 'overlay.pick.away'],
    ['athlete not outlined', { phase: 'parked', step: 2, total: 4, assignedCount: 1, boxed: false }, 'overlay.pick.not-outlined'],
    ['done', { phase: 'done', step: null, total: 4, assignedCount: 4, boxed: true }, 'overlay.pick.done'],
  ];

  it.each(CASES)('%s renders the resolver state id', (_name, props, id) => {
    render(<SpotlightPickGuide {...props} />);
    expect(screen.getByTestId('spotlight-pick-guide').getAttribute('data-guide-id')).toBe(id);
    const { phase, step, total, assignedCount, boxed } = props;
    expect(resolvePickGuide({ phase, step, total, assigned: assignedCount, boxed }).id).toBe(id);
  });

  it('shows the not-outlined hint when the parent says boxes are off, without a click', () => {
    render(<SpotlightPickGuide phase="parked" step={2} total={4} assignedCount={1} boxed={false} />);
    expect(document.body.textContent).toContain(GUIDE.overlay.pick.notOutlined.title);
  });

  it('keeps the hint tied to the boxes across a step change (no private flag to drift)', () => {
    const props = { phase: 'parked', total: 4, assignedCount: 1, boxed: false };
    const { rerender } = render(<SpotlightPickGuide {...props} step={2} />);
    rerender(<SpotlightPickGuide {...props} step={3} />);
    expect(document.body.textContent).toContain(GUIDE.overlay.pick.notOutlined.title);
  });

  it('the toggle asks the parent; it does not flip a private copy when controlled', () => {
    const onNotBoxed = vi.fn();
    render(
      <SpotlightPickGuide phase="parked" step={1} total={4} assignedCount={0} boxed onNotBoxed={onNotBoxed} />
    );
    fireEvent.click(screen.getByTestId('pick-guide-not-boxed'));
    expect(onNotBoxed).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).not.toContain(GUIDE.overlay.pick.notOutlined.title);
  });
});
