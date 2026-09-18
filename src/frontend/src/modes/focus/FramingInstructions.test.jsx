import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FramingInstructions from './FramingInstructions';

/**
 * T9610: the framing guide that teaches a first-time parent to frame their player
 * and prompts a PREVIEW (press play) before a paid render.
 *
 * 2026-09-18 (user request, round 2): the header no longer shows a play icon or
 * "Press play to preview..." when collapsed -- just "Instructions". The step-by-step
 * copy is no longer a numbered list -- one plain paragraph instead. The stage-reason
 * line ("Focus the action...") is now sized up as the headline, bigger than the
 * instructional copy that follows it.
 */
describe('FramingInstructions (T9610)', () => {
  it('shows the stage reason and instructional copy when expanded, in plain language', () => {
    render(<FramingInstructions focusPointCount={0} expanded onToggle={vi.fn()} />);

    // No numbered list anymore -- plain instructional paragraph, no "keyframe".
    expect(screen.getByTestId('framing-instructions').querySelector('ol')).toBeNull();
    const steps = screen.getByTestId('framing-instructions-steps').textContent;
    expect(steps).toMatch(/move the box so it captures your athlete and the play/i);
    expect(steps).toMatch(/re-adjust the box as needed so it stays focused on your player/i);
    expect(steps).toMatch(/slow-mo to capture key athlete movements/i);

    // T9860 3.5: the stage reason is stated above the instructional copy, and reads
    // as the headline -- bigger (text-sm) than the steps/focus-point copy (text-xs).
    const reason = screen.getByText(/focus the action on your player, crop out everything else/i);
    expect(reason.className).toMatch(/text-sm/);
    expect(screen.getByTestId('framing-instructions-steps').className).toMatch(/text-xs/);

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

  it('collapses to a plain "Instructions" header, no play icon or step list', () => {
    render(<FramingInstructions focusPointCount={2} expanded={false} onToggle={vi.fn()} />);
    // No step list when collapsed.
    expect(screen.getByTestId('framing-instructions').querySelector('ol')).toBeNull();
    // The collapsed header is a plain label -- no "press play" copy, no play icon.
    const toggle = screen.getByTestId('framing-instructions-toggle');
    expect(toggle.textContent).toBe('Instructions');
    expect(toggle.querySelector('svg.lucide-play')).toBeNull();
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
