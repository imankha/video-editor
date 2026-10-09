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
    expect(screen.getByTestId('framing-preview-toggle').textContent).toMatch(/back to full video/i);
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

describe('FramingActionRow - Trim and SlowMo + locked state', () => {
  it('renders Trim and SlowMo only when onToggleTrim is provided', () => {
    const { rerender } = render(<FramingActionRow onTogglePreview={vi.fn()} />);
    expect(screen.queryByTestId('trim-slowmo-button')).toBeNull();
    rerender(<FramingActionRow onTogglePreview={vi.fn()} onToggleTrim={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Trim and slow motion' })).toBeTruthy();
  });

  it('calls onToggleTrim on click and reflects trimOpen via aria-pressed', () => {
    const onToggleTrim = vi.fn();
    const { rerender } = render(<FramingActionRow onToggleTrim={onToggleTrim} />);
    fireEvent.click(screen.getByTestId('trim-slowmo-button'));
    expect(onToggleTrim).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('trim-slowmo-button').getAttribute('aria-pressed')).toBe('false');
    rerender(<FramingActionRow onToggleTrim={onToggleTrim} trimOpen />);
    expect(screen.getByTestId('trim-slowmo-button').getAttribute('aria-pressed')).toBe('true');
  });

  it('disables Trim and SlowMo and Preview highlight together while locked', () => {
    const { rerender } = render(
      <FramingActionRow locked onTogglePreview={vi.fn()} onToggleTrim={vi.fn()} />
    );
    expect(screen.getByTestId('trim-slowmo-button').disabled).toBe(true);
    expect(screen.getByTestId('framing-preview-toggle').disabled).toBe(true);
    expect(screen.getByTestId('trim-slowmo-button').title).toMatch(/finish the steps/i);

    rerender(<FramingActionRow onTogglePreview={vi.fn()} onToggleTrim={vi.fn()} />);
    expect(screen.getByTestId('trim-slowmo-button').disabled).toBe(false);
    expect(screen.getByTestId('framing-preview-toggle').disabled).toBe(false);
  });

  it('never renders a Set/Add focus point button', () => {
    render(<FramingActionRow onTogglePreview={vi.fn()} onToggleTrim={vi.fn()} />);
    expect(screen.queryByTestId('set-focus-point-button')).toBeNull();
  });
});

// 2026-10-09 (user screenshot): inline inside ActionBand's 3-column `above` grid the row is
// `display: contents`, so the col-span-2 disclosure took the next row's first two cells and
// pushed Generate highlight onto a second row, offset right. The disclosure must sit on its
// own full-width row AFTER the CTA so the two cards and Generate share one row.
describe('FramingActionRow inline in ActionBand - disclosure never displaces the CTA', () => {
  it('places the preview disclosure on its own full-width row after the CTA', () => {
    render(<FramingActionRow inline previewing onTogglePreview={vi.fn()} onToggleTrim={vi.fn()} />);
    const classes = screen.getByTestId('preview-disclosure').className.split(/\s+/);
    expect(classes).toContain('col-span-full');
    expect(classes).toContain('order-last');
    expect(classes).not.toContain('col-span-2');
  });
});

// T12020: the Preview caption follows the label. "Back to full video" must not
// carry the framing-check subtitle, which only makes sense before previewing.
describe('FramingActionRow - state-aware Preview caption (T12020)', () => {
  it('shows the framing-check caption when not previewing', () => {
    render(<FramingActionRow previewing={false} onTogglePreview={vi.fn()} />);
    expect(screen.getByTestId('framing-preview-toggle').textContent).toMatch(/check the framing before generating/i);
  });

  it('swaps the caption to the return-to-box wording while previewing', () => {
    render(<FramingActionRow previewing onTogglePreview={vi.fn()} />);
    const toggle = screen.getByTestId('framing-preview-toggle');
    expect(toggle.textContent).not.toMatch(/check the framing before generating/i);
    expect(toggle.textContent).toMatch(/return to dragging the box/i);
  });
});
