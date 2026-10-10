import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import SpotlightPickGuide from './SpotlightPickGuide';
import { GUIDE } from '../../../config/displayNames';
import { resolveGuide } from '../../../components/instructions/resolveGuide';

const BANNED = /tracker|frame \d|frames|box/i;

describe('SpotlightPickGuide T12280', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('clicking the X does not reach the stage click handler', () => {
    const stageClick = vi.fn();
    render(
      <div onClick={stageClick}>
        <SpotlightPickGuide phase="parked" step={1} total={4} assignedCount={0} />
      </div>
    );
    fireEvent.click(screen.getByLabelText('Turn off guidance'));
    expect(stageClick).not.toHaveBeenCalled();
  });

  it('uses moment / athlete vocabulary in every phase', () => {
    const { container, rerender } = render(<SpotlightPickGuide phase="parked" step={1} total={4} assignedCount={0} />);
    expect(screen.getByTestId('pick-guide-step').textContent).toBe('Moment 1 of 4');
    expect(container.textContent).not.toMatch(BANNED);
    fireEvent.click(screen.getByTestId('pick-guide-not-boxed'));
    expect(container.textContent).toContain(GUIDE.overlay.pick.notOutlined.title);
    expect(container.textContent).not.toMatch(BANNED);
    rerender(<SpotlightPickGuide phase="away" step={2} total={4} assignedCount={1} />);
    expect(container.textContent).not.toMatch(BANNED);
    expect(screen.getByRole('button', { name: 'Next moment' })).toBeTruthy();
  });

  describe('done', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('is persistent (no 4 s hide), one column, points at Generate', () => {
      render(<SpotlightPickGuide phase="done" total={3} isPlaying={false} />);
      act(() => { vi.advanceTimersByTime(10000); });
      const text = screen.getByTestId('spotlight-pick-guide').textContent;
      expect(text).toContain('Generate highlight');
      expect(text).not.toMatch(BANNED);
      expect(screen.getByTestId('pick-guide-done-body').className).toContain('flex-col');
    });
  });

  it('resolver enumerates the 8 pick states', () => {
    const pick = (p) => resolveGuide({ screen: 'overlay', job: { status: 'none' }, local: { pick: p } })?.id;
    expect(pick({ phase: 'parked', step: 1, total: 4, assigned: 0, boxed: true })).toBe('overlay.pick.first');
    expect(pick({ phase: 'confirm', step: 1, total: 4, assigned: 1, boxed: true })).toBe('overlay.pick.next');
    expect(pick({ phase: 'parked', step: 2, total: 4, assigned: 1, boxed: true, atMarker: true })).toBe('overlay.pick.at-marker');
    expect(pick({ phase: 'away', step: 2, total: 4, assigned: 1, boxed: true })).toBe('overlay.pick.away');
    expect(pick({ phase: 'parked', step: 2, total: 4, assigned: 1, boxed: false })).toBe('overlay.pick.not-outlined');
    expect(pick({ phase: 'parked', step: 1, total: 4, assigned: 0, boxed: false, noBoxes: true })).toBe('overlay.pick.none');
    expect(pick({ phase: 'done', step: null, total: 4, assigned: 4 })).toBe('overlay.pick.done');
    expect(resolveGuide({ screen: 'overlay', job: { status: 'none' }, local: { textOpen: true } })?.id).toBe('overlay.text');
  });
});
