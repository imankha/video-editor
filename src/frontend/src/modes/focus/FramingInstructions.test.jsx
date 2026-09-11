import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FramingInstructions from './FramingInstructions';

/**
 * T9610: the three-step framing guide that teaches a first-time parent to frame
 * their player and prompts a PREVIEW (press play) before a paid render.
 */
describe('FramingInstructions (T9610)', () => {
  it('shows the three-step sequence and the preview prompt when expanded', () => {
    render(<FramingInstructions focusPointCount={0} expanded onToggle={vi.fn()} />);

    // Three numbered steps, in plain language (no "keyframe").
    const steps = screen.getByTestId('framing-instructions').querySelectorAll('ol li');
    expect(steps).toHaveLength(3);
    expect(screen.queryByText(/move the box over your player/i)).not.toBeNull();
    expect(screen.queryByText(/step forward in the video/i)).not.toBeNull();
    expect(screen.queryByText(/move the box again to follow them/i)).not.toBeNull();

    // The preview prompt points at ordinary playback, before export.
    const prompt = screen.getByTestId('framing-preview-prompt').textContent;
    expect(prompt).toMatch(/press play to preview/i);
    expect(prompt).toMatch(/before you export/i);
  });

  it('uses the shared "Focus point" noun and never says "keyframe"', () => {
    render(<FramingInstructions focusPointCount={0} expanded onToggle={vi.fn()} />);
    const el = screen.getByTestId('framing-instructions');
    expect(el.textContent.toLowerCase()).toContain('focus point');
    expect(el.textContent.toLowerCase()).not.toContain('keyframe');
  });

  it('collapses to a visible preview prompt (no step list) when collapsed', () => {
    render(<FramingInstructions focusPointCount={2} expanded={false} onToggle={vi.fn()} />);
    // No step list when collapsed.
    expect(screen.getByTestId('framing-instructions').querySelector('ol')).toBeNull();
    // The collapsed header still surfaces the preview prompt prominently.
    expect(screen.getByTestId('framing-instructions-toggle').textContent).toMatch(/press play to preview/i);
  });

  it('toggles via the header button', () => {
    const onToggle = vi.fn();
    render(<FramingInstructions focusPointCount={0} expanded onToggle={onToggle} />);
    fireEvent.click(screen.getByTestId('framing-instructions-toggle'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('emphasizes the preview prompt once two focus points exist', () => {
    const { rerender } = render(
      <FramingInstructions focusPointCount={1} expanded onToggle={vi.fn()} />
    );
    // Before framing success: muted.
    expect(screen.getByTestId('framing-preview-prompt').className).toMatch(/text-gray-400/);

    rerender(<FramingInstructions focusPointCount={2} expanded onToggle={vi.fn()} />);
    // After two focus points: emphasized.
    expect(screen.getByTestId('framing-preview-prompt').className).toMatch(/text-blue-200/);
  });
});
