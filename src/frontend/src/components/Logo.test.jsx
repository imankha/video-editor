import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { LogoWithText } from './Logo';

describe('LogoWithText lockup (T5675)', () => {
  it('renders the wordmark as one intentional single-line unit', () => {
    render(<LogoWithText />);
    // Single "Reel Ballers" string, not split "Reel" / "Ballers" spans.
    const wordmark = screen.getByText('Reel Ballers');
    expect(wordmark).toBeTruthy();
    expect(wordmark.className).toMatch(/whitespace-nowrap/);
    expect(screen.queryByText('Reel')).toBeNull();
    expect(screen.queryByText('Ballers')).toBeNull();
  });

  it('lays out horizontally (emblem left of wordmark), not a stacked column', () => {
    const { container } = render(<LogoWithText />);
    const root = container.firstChild;
    expect(root.className).toMatch(/inline-flex/);
    expect(root.className).toMatch(/items-center/);
    expect(root.className).not.toMatch(/flex-col/);
  });

  it('exposes the clickable emblem with its aria-label when onLogoClick is provided', () => {
    render(<LogoWithText onLogoClick={() => {}} logoAriaLabel="Replay" />);
    expect(screen.getByRole('button', { name: 'Replay' })).toBeTruthy();
  });
});
