import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import FramingActionRow from './FramingActionRow';

// T10310 (2026-09-18 user request): "Use a wider frame" was removed along with
// its underlying isWideFraming/onWidenFraming wiring (utils/widenFraming.js and
// its FocusContainer handler are gone too) -- this row is [Undo] [Preview
// highlight] now.
describe('FramingActionRow (T9950 Slice 2, T10310)', () => {
  it('disables Undo and shows "Nothing to undo" when canUndo is false', () => {
    render(<FramingActionRow canUndo={false} onUndo={vi.fn()} />);
    const undoBtn = screen.getByTestId('framing-undo');
    expect(undoBtn.disabled).toBe(true);
    expect(undoBtn.getAttribute('title')).toMatch(/nothing to undo/i);
  });

  it('enables Undo and calls onUndo when canUndo is true', () => {
    const onUndo = vi.fn();
    render(<FramingActionRow canUndo onUndo={onUndo} />);
    const undoBtn = screen.getByTestId('framing-undo');
    expect(undoBtn.disabled).toBe(false);
    fireEvent.click(undoBtn);
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it('never renders a "Use a wider frame" control', () => {
    render(<FramingActionRow canUndo onUndo={vi.fn()} previewing onTogglePreview={vi.fn()} />);
    expect(screen.queryByTestId('framing-widen')).toBeNull();
    expect(screen.queryByText(/wider frame/i)).toBeNull();
  });

  it('does not render the Preview button until Slice 3 wires onTogglePreview', () => {
    render(<FramingActionRow canUndo={false} onUndo={vi.fn()} />);
    expect(screen.queryByTestId('framing-preview-toggle')).toBeNull();
  });

  it('renders the Preview toggle once onTogglePreview is provided, and flips its label when previewing', () => {
    const { rerender } = render(
      <FramingActionRow canUndo={false} onUndo={vi.fn()} previewing={false} onTogglePreview={vi.fn()} />
    );
    expect(screen.getByTestId('framing-preview-toggle').textContent).toMatch(/preview highlight/i);

    rerender(
      <FramingActionRow canUndo={false} onUndo={vi.fn()} previewing onTogglePreview={vi.fn()} />
    );
    expect(screen.getByTestId('framing-preview-toggle').textContent).toMatch(/back to framing/i);
  });

  it('shows the approximation disclosure only while previewing', () => {
    const { rerender } = render(
      <FramingActionRow canUndo={false} onUndo={vi.fn()} previewing={false} onTogglePreview={vi.fn()} />
    );
    expect(screen.queryByTestId('preview-disclosure')).toBeNull();

    rerender(
      <FramingActionRow canUndo={false} onUndo={vi.fn()} previewing onTogglePreview={vi.fn()} />
    );
    expect(screen.getByTestId('preview-disclosure').textContent).toMatch(/final image quality is produced at export/i);
  });

  it('adds the multi-clip disclosure line when previewing a multi-clip project', () => {
    render(
      <FramingActionRow canUndo={false} onUndo={vi.fn()} previewing onTogglePreview={vi.fn()} isMultiClip />
    );
    expect(screen.getByTestId('preview-disclosure').textContent).toMatch(/your clips are joined at export/i);
  });
});
