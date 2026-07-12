import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BrandedEndCard } from './BrandedEndCard';

const CTA_URL =
  'https://www.reelballers.com/?utm_source=share_endcard&utm_medium=viral&utm_campaign=reel_endcard';

describe('BrandedEndCard', () => {
  it('renders nothing when visible=false', () => {
    const { container } = render(<BrandedEndCard visible={false} onReplay={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the CTA, Made With text, and logo row when visible=true', () => {
    render(<BrandedEndCard visible={true} onReplay={() => {}} />);
    expect(screen.getByText('Make your own reel at www.reelballers.com')).toBeTruthy();
    expect(screen.getByText('Made With')).toBeTruthy();
    expect(screen.getByText('Reel')).toBeTruthy();
    expect(screen.getByText('Ballers')).toBeTruthy();
  });

  it('CTA links to reelballers.com with UTM params, opens in new tab', () => {
    render(<BrandedEndCard visible={true} onReplay={() => {}} />);
    const cta = screen.getByText('Make your own reel at www.reelballers.com').closest('a');
    expect(cta.href).toBe(CTA_URL);
    expect(cta.target).toBe('_blank');
    expect(cta.rel).toContain('noopener');
  });

  it('no separate quiet link — URL is in the CTA button text only', () => {
    render(<BrandedEndCard visible={true} onReplay={() => {}} />);
    const links = document.querySelectorAll('a');
    expect(links.length).toBe(1);
  });

  it('clicking the logo emblem (Replay button) calls onReplay', () => {
    const onReplay = vi.fn();
    render(<BrandedEndCard visible={true} onReplay={onReplay} />);
    fireEvent.click(screen.getByLabelText('Replay'));
    expect(onReplay).toHaveBeenCalledTimes(1);
  });

  it('clicking the CTA link does NOT call onReplay', () => {
    const onReplay = vi.fn();
    render(<BrandedEndCard visible={true} onReplay={onReplay} />);
    fireEvent.click(screen.getByText('Make your own reel at www.reelballers.com'));
    expect(onReplay).not.toHaveBeenCalled();
  });

  it('is prop-gated: only shows on surfaces that pass visible=true (never in editor/ranker/My Reels)', () => {
    const { rerender, container } = render(<BrandedEndCard visible={false} onReplay={() => {}} />);
    expect(container.firstChild).toBeNull();
    rerender(<BrandedEndCard visible={true} onReplay={() => {}} />);
    expect(screen.getByText('Make your own reel at www.reelballers.com')).toBeTruthy();
  });
});
