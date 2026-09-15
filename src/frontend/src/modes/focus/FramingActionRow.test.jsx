import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import FramingActionRow from './FramingActionRow';

describe('FramingActionRow (T9950 Slice 2)', () => {
  it('disables Undo and shows "Nothing to undo" when canUndo is false', () => {
    render(<FramingActionRow canUndo={false} onUndo={vi.fn()} isWideFraming={false} onWidenFraming={vi.fn()} />);
    const undoBtn = screen.getByTestId('framing-undo');
    expect(undoBtn.disabled).toBe(true);
    expect(undoBtn.getAttribute('title')).toMatch(/nothing to undo/i);
  });

  it('enables Undo and calls onUndo when canUndo is true', () => {
    const onUndo = vi.fn();
    render(<FramingActionRow canUndo onUndo={onUndo} isWideFraming={false} onWidenFraming={vi.fn()} />);
    const undoBtn = screen.getByTestId('framing-undo');
    expect(undoBtn.disabled).toBe(false);
    fireEvent.click(undoBtn);
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it('shows "Use a wider frame" when not wide, and calls onWidenFraming on click', () => {
    const onWiden = vi.fn();
    render(<FramingActionRow canUndo={false} onUndo={vi.fn()} isWideFraming={false} onWidenFraming={onWiden} />);
    const widenBtn = screen.getByTestId('framing-widen');
    expect(widenBtn.textContent).toMatch(/use a wider frame/i);
    expect(widenBtn.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(widenBtn);
    expect(onWiden).toHaveBeenCalledTimes(1);
  });

  it('flips to "Back to default frame" when already wide', () => {
    render(<FramingActionRow canUndo={false} onUndo={vi.fn()} isWideFraming onWidenFraming={vi.fn()} />);
    const widenBtn = screen.getByTestId('framing-widen');
    expect(widenBtn.textContent).toMatch(/back to default frame/i);
    expect(widenBtn.getAttribute('aria-pressed')).toBe('true');
  });

  it('does not render the Preview button until Slice 3 wires onTogglePreview', () => {
    render(<FramingActionRow canUndo={false} onUndo={vi.fn()} isWideFraming={false} onWidenFraming={vi.fn()} />);
    expect(screen.queryByTestId('framing-preview-toggle')).toBeNull();
  });

  it('renders the Preview toggle once onTogglePreview is provided, and flips its label when previewing', () => {
    const { rerender } = render(
      <FramingActionRow canUndo={false} onUndo={vi.fn()} isWideFraming={false} onWidenFraming={vi.fn()}
        previewing={false} onTogglePreview={vi.fn()} />
    );
    expect(screen.getByTestId('framing-preview-toggle').textContent).toMatch(/preview highlight/i);

    rerender(
      <FramingActionRow canUndo={false} onUndo={vi.fn()} isWideFraming={false} onWidenFraming={vi.fn()}
        previewing onTogglePreview={vi.fn()} />
    );
    expect(screen.getByTestId('framing-preview-toggle').textContent).toMatch(/back to framing/i);
  });

  it('shows the approximation disclosure only while previewing', () => {
    const { rerender } = render(
      <FramingActionRow canUndo={false} onUndo={vi.fn()} isWideFraming={false} onWidenFraming={vi.fn()}
        previewing={false} onTogglePreview={vi.fn()} />
    );
    expect(screen.queryByTestId('preview-disclosure')).toBeNull();

    rerender(
      <FramingActionRow canUndo={false} onUndo={vi.fn()} isWideFraming={false} onWidenFraming={vi.fn()}
        previewing onTogglePreview={vi.fn()} />
    );
    expect(screen.getByTestId('preview-disclosure').textContent).toMatch(/final image quality is produced at export/i);
  });

  it('adds the multi-clip disclosure line when previewing a multi-clip project', () => {
    render(
      <FramingActionRow canUndo={false} onUndo={vi.fn()} isWideFraming={false} onWidenFraming={vi.fn()}
        previewing onTogglePreview={vi.fn()} isMultiClip />
    );
    expect(screen.getByTestId('preview-disclosure').textContent).toMatch(/your clips are joined at export/i);
  });
});
