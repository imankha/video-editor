import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { StorageExpiryBanner } from './StorageExpiryBanner';

describe('StorageExpiryBanner (T8330)', () => {
  // JSX splits the copy across text nodes / {' '} spacers, so compare on a
  // whitespace-collapsed textContent rather than exact node boundaries.
  const bannerText = () =>
    screen.getByTestId('storage-expiry-banner').textContent.replace(/\s+/g, ' ').trim();

  it('renders nothing when no game is at risk', () => {
    const { container } = render(
      <StorageExpiryBanner atRiskGameCount={0} dependentDraftCount={0} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('uses plural copy for multiple games and reels', () => {
    render(<StorageExpiryBanner atRiskGameCount={3} dependentDraftCount={5} />);
    expect(bannerText()).toContain('3 games expiring soon');
    expect(bannerText()).toContain('5 draft reels depend on them');
  });

  it('uses singular copy for one game and one reel', () => {
    render(<StorageExpiryBanner atRiskGameCount={1} dependentDraftCount={1} />);
    expect(bannerText()).toContain('1 game expiring soon');
    expect(bannerText()).toContain('1 draft reel depends on it');
  });

  it('fires onExtend when the Extend storage CTA is clicked', () => {
    const onExtend = vi.fn();
    render(<StorageExpiryBanner atRiskGameCount={1} dependentDraftCount={1} onExtend={onExtend} />);
    fireEvent.click(screen.getByRole('button', { name: 'Extend storage' }));
    expect(onExtend).toHaveBeenCalledTimes(1);
  });

  it('fires onDismiss when the dismiss control is clicked', () => {
    const onDismiss = vi.fn();
    render(<StorageExpiryBanner atRiskGameCount={2} dependentDraftCount={2} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
