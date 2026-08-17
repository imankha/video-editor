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

  it('enforces the 44px touch target by POINTER, not by viewport width', () => {
    render(<AspectRatioSelector aspectRatio="9:16" onAspectRatioChange={vi.fn()} />);

    for (const button of screen.getAllByRole('button')) {
      // `coarse-pointer:` (tailwind.config.js) covers phone AND tablet, including a
      // tablet in landscape at >= 1024px — a `lg:` breakpoint would drop the floor
      // exactly there and re-introduce the T5360 sub-44px-on-tablet regression.
      expect(button.className).toContain('coarse-pointer:min-h-11');
      expect(button.className).toContain('coarse-pointer:min-w-11');
      // Fine-pointer desktop keeps its existing sizing by construction (no reset needed).
      expect(button.className).not.toMatch(/\blg:min-[hw]-/);
    }
  });

  it('exposes the current ratio even when it matches neither option', () => {
    // 1:1 reels are creatable (GameClipSelectorModal) but have no button here.
    render(<AspectRatioSelector aspectRatio="1:1" onAspectRatioChange={vi.fn()} />);

    expect(screen.getByRole('group', { name: /currently 1:1/ })).toBeTruthy();
    for (const button of screen.getAllByRole('button')) {
      expect(button.getAttribute('aria-pressed')).toBe('false');
    }
  });
});
