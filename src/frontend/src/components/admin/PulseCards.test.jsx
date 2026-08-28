import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { PulseCards } from './PulseCards';

const BASE_CARDS = {
  signups: { today: 5, change_pct: 10, sparkline: [] },
  exports: { today: 3, change_pct: -5, sparkline: [] },
  active_users: { today: 12, change_pct: 0, sparkline: [] },
  revenue: { today: 500, change_pct: 2, sparkline: [] },
  viral_conversion: { today: 30, change_pct: 1, sparkline: [] },
};

describe('PulseCards upload success rate (T7510)', () => {
  it('renders nothing when there is no data', () => {
    const { container } = render(<PulseCards data={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows the succeeded/attempts breakdown, not the week-over-week delta', () => {
    const data = {
      cards: {
        ...BASE_CARDS,
        upload_success_rate: { today: 62.5, succeeded: 5, failed: 3, attempts: 8, sparkline: [] },
      },
    };
    render(<PulseCards data={data} />);
    expect(screen.getByText('Upload Success')).toBeTruthy();
    expect(screen.getByText('62.5%')).toBeTruthy();
    expect(screen.getByText('5/8 succeeded')).toBeTruthy();
  });

  it('renders "--" (not a misleading 0% or 100%) when there were zero attempts', () => {
    const data = {
      cards: {
        ...BASE_CARDS,
        upload_success_rate: { today: null, succeeded: 0, failed: 0, attempts: 0, sparkline: [] },
      },
    };
    render(<PulseCards data={data} />);
    expect(screen.getByText('--')).toBeTruthy();
    expect(screen.getByText('0/0 succeeded')).toBeTruthy();
  });
});

describe('PulseCards day-boundary labeling (T7990)', () => {
  it('labels the delta "vs same day last week", not an implied weekly rollup', () => {
    // The tile value is a single (UTC) day and change_pct compares it to the same weekday
    // one week prior, so the old "vs last week" copy misread as a weekly total.
    const { container } = render(<PulseCards data={{ cards: BASE_CARDS }} />);
    expect(container.textContent).toContain('vs same day last week');
    expect(container.textContent).not.toContain('% vs last week');
  });
});
