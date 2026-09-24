import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { ChannelsTable } from './ChannelsTable';

const CH = {
  origin: 'tiktok', users: 3, direct: 2, viral: 1, exported: 1, export_pct: 33,
  purchased: 1, purchase_pct: 33, revenue_cents: 1000, avg_exports: 2,
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
