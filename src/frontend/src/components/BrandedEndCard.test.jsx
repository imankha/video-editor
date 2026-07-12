import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BrandedEndCard } from './BrandedEndCard';

describe('BrandedEndCard', () => {
  it('renders nothing when visible=false', () => {
    const { container } = render(<BrandedEndCard visible={false} onReplay={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the wordmark and URL when visible=true', () => {
    render(<BrandedEndCard visible={true} onReplay={() => {}} />);
    expect(screen.getByText('Made with Reel Ballers')).toBeTruthy();
    expect(screen.getByText('reelballers.com')).toBeTruthy();
  });

  it('shows a Replay button that calls onReplay', () => {
    const onReplay = vi.fn();
    render(<BrandedEndCard visible={true} onReplay={onReplay} />);
    fireEvent.click(screen.getByText('Replay'));
    expect(onReplay).toHaveBeenCalledTimes(1);
  });

  it('is prop-gated: only shows on surfaces that pass visible=true (never in editor/ranker/My Reels)', () => {
    // visible=false is how the editor/ranker/My Reels omit the card -- they never set it.
    const { rerender, container } = render(<BrandedEndCard visible={false} onReplay={() => {}} />);
    expect(container.firstChild).toBeNull();
    rerender(<BrandedEndCard visible={true} onReplay={() => {}} />);
    expect(screen.getByText('Made with Reel Ballers')).toBeTruthy();
  });
});
