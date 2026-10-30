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

describe('PulseCards upload success alarm (T7510/T8170)', () => {
  it('renders nothing when there is no data', () => {
    const { container } = render(<PulseCards data={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('keeps the collapse alarm banner even though Upload Success is now a table column', () => {
    const data = {
      cards: {
        ...BASE_CARDS,
        upload_success_rate: { today: 20, succeeded: 2, failed: 8, attempts: 10, alarm: true, sparkline: [] },
      },
    };
    render(<PulseCards data={data} />);
    expect(screen.getByRole('alert').textContent).toContain('2/10 succeeded today');
  });
});

describe('PulseCards show only the KPIs the dimension tables do not (T13990)', () => {
  const POPULATION = { avg_exports: 2.5, time_to_export_days: 3.1, return_7d_pct: 40 };

  function labels(container) {
    return [...container.querySelectorAll('[data-testid="pulse-card-label"]')].map(n => n.textContent);
  }

  it('renders the flow cards and the population cards, never the table KPIs', () => {
    const data = {
      cards: { ...BASE_CARDS, upload_success_rate: { today: 90, succeeded: 9, attempts: 10, sparkline: [] } },
      population: POPULATION,
    };
    const { container } = render(<PulseCards data={data} />);
    expect(labels(container)).toEqual([
      'Exports', 'Active Users', 'Viral Conv.', 'Avg Exports', 'Time-to-Export', '7d Return',
    ]);
  });

  it('population cards show one value for the filtered population, with no day-over-day delta', () => {
    render(<PulseCards data={{ cards: BASE_CARDS, population: POPULATION }} />);
    expect(screen.getByText('2.5')).toBeTruthy();
    expect(screen.getByText('3.1d')).toBeTruthy();
    expect(screen.getByText('40%')).toBeTruthy();
    const card = screen.getByText('3.1d').closest('[data-testid="pulse-card"]');
    expect(card.textContent).not.toContain('same day last week');
  });

  it('a population KPI with no data reads "--"', () => {
    render(<PulseCards data={{
      cards: BASE_CARDS,
      population: { avg_exports: null, time_to_export_days: null, return_7d_pct: 0 },
    }} />);
    expect(screen.getAllByText('--')).toHaveLength(2);
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
