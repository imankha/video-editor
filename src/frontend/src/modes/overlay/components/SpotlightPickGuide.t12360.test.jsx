import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import SpotlightPickGuide from './SpotlightPickGuide';
import { resolvePickGuide } from '../../../components/instructions/resolveGuide';

// T12360: each pick state's visible text is defined once. What the pill renders is exactly the
// resolver message for that state (title and body), never a second hand-written copy.
describe('SpotlightPickGuide T12360: pill text is the resolver copy', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))); });
  afterEach(() => { vi.unstubAllGlobals(); });

  const msg = (p) => resolvePickGuide({ ...p, assigned: p.assignedCount }).message;

  it('first moment: pill title and why-line are the resolver title and body', () => {
    const p = { phase: 'parked', step: 1, total: 4, assignedCount: 0, boxed: true };
    const { container } = render(<SpotlightPickGuide {...p} isTouch />);
    const m = msg(p);
    expect(screen.getByTestId('pick-guide-text').textContent).toBe(m.title);
    expect(container.textContent).toContain(m.body);
    expect(m.title).toBe('Tap your athlete');
  });

  it('later moment: pill title and again-line are the resolver title and body', () => {
    const p = { phase: 'parked', step: 2, total: 4, assignedCount: 1, boxed: true };
    const { container } = render(<SpotlightPickGuide {...p} isTouch />);
    const m = msg(p);
    expect(screen.getByTestId('pick-guide-text').textContent).toBe(m.title);
    expect(container.textContent).toContain(m.body);
  });

  it('just tapped: pill confirm text is the resolver title', () => {
    const p = { phase: 'confirm', step: 1, total: 4, assignedCount: 1, boxed: true };
    render(<SpotlightPickGuide {...p} isTouch />);
    expect(screen.getByTestId('pick-guide-text').textContent).toBe(msg(p).title);
  });

  it('scrubbed away: pill text is the resolver title for that moment', () => {
    const p = { phase: 'away', step: 2, total: 4, assignedCount: 1, boxed: true };
    render(<SpotlightPickGuide {...p} />);
    expect(screen.getByTestId('pick-guide-text').textContent).toBe(msg(p).title);
    expect(msg(p).title).toBe('Moment 2 of 4 still needs a tap');
  });

  it('keeps the step label on its own line, not inside the sentence', () => {
    const p = { phase: 'parked', step: 1, total: 4, assignedCount: 0, boxed: true };
    render(<SpotlightPickGuide {...p} isTouch />);
    expect(screen.getByTestId('pick-guide-step').textContent).toBe('Moment 1 of 4');
    expect(msg(p).title).not.toMatch(/of 4/);
  });
});
