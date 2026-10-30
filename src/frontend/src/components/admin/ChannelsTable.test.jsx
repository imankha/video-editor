import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { ChannelsTable } from './ChannelsTable';

const CH = {
  origin: 'tiktok', signups: 3, revenue_cents: 1000, upload_success_pct: 100,
  uploaded_pct: 33, clipped_pct: 33, exported_pct: 33, shared_pct: 0, purchased_pct: 33,
};

describe('ChannelsTable Unattributed remainder (T8650)', () => {
  it('renders an Unattributed row with the remainder when it is nonzero', () => {
    render(<ChannelsTable data={{ channels: [CH], unattributed_revenue_cents: 399 }} />);
    expect(screen.getByText('Unattributed')).toBeTruthy();
    expect(screen.getByText('$3.99')).toBeTruthy();
  });

  it('hides the Unattributed row when the remainder is 0', () => {
    render(<ChannelsTable data={{ channels: [CH], unattributed_revenue_cents: 0 }} />);
    expect(screen.queryByText('Unattributed')).toBeNull();
  });

  it('still shows the remainder when there are no campaign rows (Gap 3)', () => {
    // Only deleted payers: no channels, but money must not be hidden behind
    // "No campaign data available."
    render(<ChannelsTable data={{ channels: [], unattributed_revenue_cents: 399 }} />);
    expect(screen.queryByText('No campaign data available.')).toBeNull();
    expect(screen.getByText('Unattributed')).toBeTruthy();
    expect(screen.getByText('$3.99')).toBeTruthy();
  });

  it('shows the empty message only when there are no rows AND no remainder', () => {
    render(<ChannelsTable data={{ channels: [], unattributed_revenue_cents: 0 }} />);
    expect(screen.getByText('No campaign data available.')).toBeTruthy();
    expect(screen.queryByText('Unattributed')).toBeNull();
  });
});

describe('ChannelsTable campaign label (T13980)', () => {
  it('shows a registered campaign by its name, with the id muted beside it', () => {
    render(<ChannelsTable data={{
      channels: [{ ...CH, origin: 'k7x2m', campaign_name: 'Fall Tryouts 2026' }],
      unattributed_revenue_cents: 0,
    }} />);
    const name = screen.getByText('Fall Tryouts 2026');
    const id = screen.getByText('k7x2m');
    expect(name.contains(id)).toBe(true);
    expect(id.className).toContain('text-gray-500');
  });

  it('shows a non-campaign origin as the raw string', () => {
    render(<ChannelsTable data={{
      channels: [{ ...CH, origin: 'my-ad-manager-name', campaign_name: null }],
      unattributed_revenue_cents: 0,
    }} />);
    expect(screen.getByText('my-ad-manager-name')).toBeTruthy();
  });
});
