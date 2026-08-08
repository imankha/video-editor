import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import PositionPresetGrid from './PositionPresetGrid';
import { Align } from '../../constants/textSpec';
import { POSITION_PRESETS } from '../../constants/textPositionPresets';

afterEach(() => cleanup());

function baseSpec(overrides = {}) {
  return { text: 'GOAL', align: Align.CENTER, position: { x: 0.5, y: 0.4 }, ...overrides };
}

describe('PositionPresetGrid (T6630 round 3)', () => {
  it('renders 9 slot buttons', () => {
    render(<PositionPresetGrid spec={baseSpec()} onChange={() => {}} />);
    // Exclude the grid container's own testid ("text-position-grid"), which
    // also matches a naive "text-position-" prefix.
    expect(screen.getAllByTestId(/^text-position-(top|center|bottom)-/)).toHaveLength(9);
  });

  it('highlights nothing when the stored position is not a preset (never auto-snaps)', () => {
    render(<PositionPresetGrid spec={baseSpec({ position: { x: 0.5, y: 0.4 } })} onChange={() => {}} />);
    for (const p of POSITION_PRESETS) {
      const btn = screen.getByTestId(`text-position-${p.vertical}-${p.horizontal}`);
      expect(btn.getAttribute('aria-pressed')).toBe('false');
    }
    expect(screen.getByText(/custom position/i)).toBeTruthy();
  });

  it('highlights the matching preset when the stored position/align hits one exactly', () => {
    const topLeft = POSITION_PRESETS.find((p) => p.vertical === 'top' && p.horizontal === 'left');
    render(<PositionPresetGrid spec={baseSpec({ position: { x: topLeft.x, y: topLeft.y }, align: topLeft.align })} onChange={() => {}} />);
    expect(screen.getByTestId('text-position-top-left').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('text-position-center-middle').getAttribute('aria-pressed')).toBe('false');
  });

  it('clicking a slot emits a COMPLETE spec patch (position + align) via onChange', () => {
    const onChange = vi.fn();
    const spec = baseSpec();
    render(<PositionPresetGrid spec={spec} onChange={onChange} />);
    fireEvent.click(screen.getByTestId('text-position-bottom-right'));
    expect(onChange).toHaveBeenCalledTimes(1);
    const patch = onChange.mock.calls[0][0];
    const bottomRight = POSITION_PRESETS.find((p) => p.vertical === 'bottom' && p.horizontal === 'right');
    expect(patch.position).toEqual({ x: bottomRight.x, y: bottomRight.y });
    expect(patch.align).toBe(bottomRight.align);
    // The rest of the spec is preserved (never a partial delta).
    expect(patch.text).toBe('GOAL');
  });
});
