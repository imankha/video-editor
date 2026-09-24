import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { CohortGrid } from './CohortGrid';

const COHORT = {
  cohort_period: '2026-09-01', signups: 3, uploaded_pct: 50, clipped_pct: 40,
  exported_pct: 30, shared_pct: 20, purchased_pct: 10, revenue_cents: 1000,
  time_to_export_days: 2, return_7d_pct: 25,
};

describe('CohortGrid Unattributed remainder (T8650)', () => {
  it('renders an Unattributed row with the remainder when it is nonzero', () => {
    render(<CohortGrid data={{ cohorts: [COHORT], unattributed_revenue_cents: 399 }} />);
    expect(screen.getByText('Unattributed')).toBeTruthy();
    expect(screen.getByText('$4')).toBeTruthy(); // cohorts render dollars with no decimals
  });

  it('hides the Unattributed row when the remainder is 0', () => {
    render(<CohortGrid data={{ cohorts: [COHORT], unattributed_revenue_cents: 0 }} />);
    expect(screen.queryByText('Unattributed')).toBeNull();
  });

  it('still shows the remainder when there are no cohort rows (Gap 3)', () => {
    render(<CohortGrid data={{ cohorts: [], unattributed_revenue_cents: 399 }} />);
    expect(screen.queryByText('No cohort data available.')).toBeNull();
    expect(screen.getByText('Unattributed')).toBeTruthy();
    expect(screen.getByText('$4')).toBeTruthy();
  });

  it('shows the empty message only when there are no rows AND no remainder', () => {
    render(<CohortGrid data={{ cohorts: [], unattributed_revenue_cents: 0 }} />);
    expect(screen.getByText('No cohort data available.')).toBeTruthy();
    expect(screen.queryByText('Unattributed')).toBeNull();
  });
});
