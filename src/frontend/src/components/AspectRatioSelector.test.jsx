import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import AspectRatioSelector from './AspectRatioSelector';

/**
 * T7130 (prod bugs 41p/42p): this selector is the only way to reshape a reel after
 * creation, and on touch it must be a real, tappable, 44px control — the old `readOnly`
 * variant rendered a control-shaped div that users tapped forever.
 */

describe('AspectRatioSelector (T7130)', () => {
  it('renders both ratios as buttons and marks the selected one', () => {
    render(<AspectRatioSelector aspectRatio="9:16" onAspectRatioChange={vi.fn()} />);

    const portrait = screen.getByRole('button', { name: /9:16/ });
    const landscape = screen.getByRole('button', { name: /16:9/ });

    expect(portrait.getAttribute('aria-pressed')).toBe('true');
    expect(landscape.getAttribute('aria-pressed')).toBe('false');
  });

  it('reports the tapped ratio to the caller', () => {
    const onAspectRatioChange = vi.fn();
    render(<AspectRatioSelector aspectRatio="9:16" onAspectRatioChange={onAspectRatioChange} />);

    fireEvent.click(screen.getByRole('button', { name: /16:9/ }));

    expect(onAspectRatioChange).toHaveBeenCalledWith('16:9');
  });

  it('meets the 44px touch target on mobile without changing desktop geometry', () => {
    render(<AspectRatioSelector aspectRatio="9:16" onAspectRatioChange={vi.fn()} />);

    for (const button of screen.getAllByRole('button')) {
      expect(button.className).toContain('min-h-11');
      expect(button.className).toContain('min-w-11');
      // Reset at lg: so the desktop controls bar keeps its existing sizing.
      expect(button.className).toContain('lg:min-h-0');
      expect(button.className).toContain('lg:min-w-0');
    }
  });
});
