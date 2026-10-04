import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import FramingActionRow from './FramingActionRow';

// T10310 (2026-09-18 user request): "Use a wider frame" was removed along with
// its underlying isWideFraming/onWidenFraming wiring (utils/widenFraming.js and
// its FocusContainer handler are gone too). Undo was subsequently removed so
// this row now contains only the Preview highlight affordance.
describe('FramingActionRow (T9950 Slice 2, T10310)', () => {
  it('does not render the retired Undo control', () => {
    render(<FramingActionRow previewing onTogglePreview={vi.fn()} />);
    expect(screen.queryByTestId('framing-undo')).toBeNull();
  });

  it('never renders a "Use a wider frame" control', () => {
    render(<FramingActionRow previewing onTogglePreview={vi.fn()} />);
    expect(screen.queryByTestId('framing-widen')).toBeNull();
    expect(screen.queryByText(/wider frame/i)).toBeNull();
  });

  it('does not render the Preview button until Slice 3 wires onTogglePreview', () => {
    render(<FramingActionRow />);
    expect(screen.queryByTestId('framing-preview-toggle')).toBeNull();
  });

  it('renders the Preview toggle once onTogglePreview is provided, and flips its label when previewing', () => {
    const { rerender } = render(
      <FramingActionRow previewing={false} onTogglePreview={vi.fn()} />
    );
    expect(screen.getByTestId('framing-preview-toggle').textContent).toMatch(/preview highlight/i);

    rerender(
      <FramingActionRow previewing onTogglePreview={vi.fn()} />
    );
    expect(screen.getByTestId('framing-preview-toggle').textContent).toMatch(/back to framing/i);
  });

  it('shows the approximation disclosure only while previewing', () => {
    const { rerender } = render(
      <FramingActionRow previewing={false} onTogglePreview={vi.fn()} />
    );
    expect(screen.queryByTestId('preview-disclosure')).toBeNull();

    rerender(
      <FramingActionRow previewing onTogglePreview={vi.fn()} />
    );
    expect(screen.getByTestId('preview-disclosure').textContent).toMatch(/final image quality is produced when you generate/i);
  });
});

// T11700: the "Set focus point" button sits first in this row (desktop/tablet,
// `hidden sm:flex`), left of Preview highlight. It commits the current crop via
// the onSetFocusPoint callback (the shared onCropComplete write path).
describe('FramingActionRow — Set focus point button (T11700)', () => {
  it('does not render the button without onSetFocusPoint', () => {
    render(<FramingActionRow onTogglePreview={vi.fn()} />);
    expect(screen.queryByTestId('set-focus-point-button')).toBeNull();
  });

  it('renders "Set focus point" in amber at 0 focus points and calls onSetFocusPoint on click', () => {
    const onSetFocusPoint = vi.fn();
    render(
      <FramingActionRow
        onSetFocusPoint={onSetFocusPoint}
        focusPointCount={0}
        onTogglePreview={vi.fn()}
      />
    );
    const btn = screen.getByTestId('set-focus-point-button');
    expect(btn.textContent).toMatch(/set focus point/i);
    expect(btn.className).toContain('border-amber-500/60');
    fireEvent.click(btn);
    expect(onSetFocusPoint).toHaveBeenCalledTimes(1);
  });

  it('renders "Add focus point" in gray secondary styling at 1+ focus points', () => {
    render(
      <FramingActionRow
        onSetFocusPoint={vi.fn()}
        focusPointCount={2}
        onTogglePreview={vi.fn()}
      />
    );
    const btn = screen.getByTestId('set-focus-point-button');
    expect(btn.textContent).toMatch(/add focus point/i);
    expect(btn.className).toContain('border-gray-700');
    expect(btn.className).not.toContain('border-amber-500/60');
  });

  it('disables the button while a crop drag is in progress', () => {
    render(
      <FramingActionRow
        onSetFocusPoint={vi.fn()}
        focusPointCount={0}
        setFocusPointDisabled
        onTogglePreview={vi.fn()}
      />
    );
    expect(screen.getByTestId('set-focus-point-button').disabled).toBe(true);
  });

  it('renders the "set" confirmation line when justSetLabel is provided', () => {
    render(
      <FramingActionRow
        onSetFocusPoint={vi.fn()}
        focusPointCount={1}
        justSetLabel="Focus point set at 0:02"
        onTogglePreview={vi.fn()}
      />
    );
    const confirm = screen.getByTestId('focus-point-set-confirm');
    expect(confirm.textContent).toMatch(/focus point set at 0:02/i);
    expect(confirm.textContent).not.toMatch(/saved/i);
  });
});
