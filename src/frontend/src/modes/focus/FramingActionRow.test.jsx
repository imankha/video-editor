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
    expect(screen.getByTestId('preview-disclosure').textContent).toMatch(/final image quality is produced at export/i);
  });
});
