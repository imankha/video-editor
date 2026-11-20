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
    expect(screen.getByTestId('framing-preview-toggle').textContent).toMatch(/preview/i);

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
    expect(screen.getByTestId('preview-disclosure').textContent).toMatch(/final picture quality comes when you sharpen/i);
  });
});

const classes = (el) => el.className.split(/\s+/);

describe('FramingActionRow - Trim and SlowMo (T14830: never locked)', () => {
  it('renders Trim and SlowMo only when onToggleTrim is provided', () => {
    const { rerender } = render(<FramingActionRow onTogglePreview={vi.fn()} />);
    expect(screen.queryByTestId('trim-slowmo-button')).toBeNull();
    rerender(<FramingActionRow onTogglePreview={vi.fn()} onToggleTrim={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Trim and slow motion' })).toBeTruthy();
  });

  it('calls onToggleTrim on click', () => {
    const onToggleTrim = vi.fn();
    render(<FramingActionRow onToggleTrim={onToggleTrim} />);
    fireEvent.click(screen.getByTestId('trim-slowmo-button'));
    expect(onToggleTrim).toHaveBeenCalledTimes(1);
  });

  // T17860 (owner ruling 2026-11-19, UX expert design): open, the button says what a tap does.
  it('T17860: reads "Done trimming" with a check icon, aria-expanded and a pressed look while open', () => {
    const { rerender } = render(<FramingActionRow onToggleTrim={vi.fn()} />);
    const closed = screen.getByTestId('trim-slowmo-button');
    expect(closed.getAttribute('aria-label')).toBe('Trim and slow motion');
    expect(closed.getAttribute('aria-expanded')).toBe('false');
    expect(closed.getAttribute('aria-controls')).toBe('frame-trim-track');
    expect(closed.hasAttribute('aria-pressed')).toBe(false);
    expect(closed.querySelector('svg').getAttribute('class')).toMatch(/lucide-scissors/);
    expect(classes(closed)).not.toContain('border-cyan-300');
    expect(closed.textContent).toMatch(/adjust timing and playback speed/i);

    rerender(<FramingActionRow onToggleTrim={vi.fn()} trimOpen />);
    const open = screen.getByTestId('trim-slowmo-button');
    expect(open.getAttribute('aria-label')).toBe('Done trimming');
    expect(open.textContent).toMatch(/^Done trimming/);
    expect(open.textContent).toMatch(/your trim and speed changes stay/i);
    expect(open.getAttribute('title')).toBe('Hide the trim and slow motion track. Your changes stay.');
    expect(open.getAttribute('aria-expanded')).toBe('true');
    expect(open.hasAttribute('aria-pressed')).toBe(false);
    expect(open.querySelector('svg').getAttribute('class')).toMatch(/lucide-check/);
    expect(classes(open)).toContain('border-cyan-300');
    expect(classes(open)).toContain('ring-cyan-300/60');
  });

  it('T17860: Preview gets the same pressed look while previewing, with no aria-pressed', () => {
    const { rerender } = render(<FramingActionRow onTogglePreview={vi.fn()} />);
    expect(classes(screen.getByTestId('framing-preview-toggle'))).not.toContain('border-cyan-300');
    expect(screen.getByTestId('framing-preview-toggle').hasAttribute('aria-pressed')).toBe(false);
    rerender(<FramingActionRow onTogglePreview={vi.fn()} previewing />);
    const on = screen.getByTestId('framing-preview-toggle');
    expect(classes(on)).toContain('border-cyan-300');
    expect(classes(on)).toContain('ring-cyan-300/60');
    expect(on.hasAttribute('aria-pressed')).toBe(false);
  });

  // T14830 (owner ruling 2026-11-07, "Confirm once"): Trim and SlowMo and
  // Preview highlight are never disabled -- there is no `locked` prop anymore,
  // and no "finish the steps" copy regardless of drag/Play state.
  it('never disables Trim and SlowMo or Preview highlight, with no lock copy', () => {
    render(<FramingActionRow onTogglePreview={vi.fn()} onToggleTrim={vi.fn()} />);
    expect(screen.getByTestId('trim-slowmo-button').disabled).toBe(false);
    expect(screen.getByTestId('framing-preview-toggle').disabled).toBe(false);
    expect(document.body.textContent).not.toMatch(/finish the steps/i);
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
    expect(screen.getByTestId('framing-preview-toggle').textContent).toMatch(/before you sharpen it/i);
  });

  it('swaps the caption to the return-to-box wording while previewing', () => {
    render(<FramingActionRow previewing onTogglePreview={vi.fn()} />);
    const toggle = screen.getByTestId('framing-preview-toggle');
    expect(toggle.textContent).not.toMatch(/before you sharpen it/i);
    expect(toggle.textContent).toMatch(/return to dragging the box/i);
  });
});
