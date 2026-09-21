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

  // T10790: presets are full-frame fractions (8% edge insets). When the video
  // preview is zoomed in (e.g. left over from framing/spotlight work), that
  // inset can land outside the cropped visible viewport -- reading as "the
  // preset put it way off in the corner" when it's really just out of view.
  // A preset click snaps the preview back to 100%/centered so the result is
  // immediately visible. `onResetZoom` (useZoom's `resetZoom`) is idempotent,
  // so the grid calls it unconditionally rather than re-deriving zoom state.
  it('calls onResetZoom AND still emits the position patch when a preset is clicked', () => {
    const onChange = vi.fn();
    const onResetZoom = vi.fn();
    const spec = baseSpec();
    render(<PositionPresetGrid spec={spec} onChange={onChange} onResetZoom={onResetZoom} />);
    fireEvent.click(screen.getByTestId('text-position-top-right'));

    expect(onResetZoom).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledTimes(1);
    const topRight = POSITION_PRESETS.find((p) => p.vertical === 'top' && p.horizontal === 'right');
    const patch = onChange.mock.calls[0][0];
    expect(patch.position).toEqual({ x: topRight.x, y: topRight.y });
    expect(patch.align).toBe(topRight.align);
  });

  it('does not throw when onResetZoom is not provided', () => {
    render(<PositionPresetGrid spec={baseSpec()} onChange={() => {}} />);
    expect(() => fireEvent.click(screen.getByTestId('text-position-top-right'))).not.toThrow();
  });
});
