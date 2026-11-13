import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { DayNRetentionTable } from './DayNRetentionTable';

const DAYS_NONE = { '1': null, '3': null, '7': null, '14': null, '28': null };

describe('DayNRetentionTable (T16070)', () => {
  it('renders a measured cell as pct + raw count', () => {
    const data = {
      checkpoints: [1, 3, 7, 14, 28],
      cohorts: [
        { cohort_week: '2026-11-02', signups: 41, days: { ...DAYS_NONE, '7': { pct: 12.2, hit: 5, aged: 41 } } },
      ],
      all_weeks: { days: DAYS_NONE },
    };
    render(<DayNRetentionTable data={data} loading={false} error={null} onRefresh={vi.fn()} />);
    expect(screen.getByText('2026-11-02')).toBeTruthy();
    expect(screen.getByText('12.20% (5 of 41)')).toBeTruthy();
  });

  it('renders an unmeasurable cell as a blank dash, never a fabricated 0%', () => {
    const data = {
      checkpoints: [1, 3, 7, 14, 28],
      cohorts: [
        { cohort_week: '2026-11-09', signups: 12, days: DAYS_NONE },
      ],
      all_weeks: { days: DAYS_NONE },
    };
    render(<DayNRetentionTable data={data} loading={false} error={null} onRefresh={vi.fn()} />);
    expect(screen.queryByText(/0\.00%/)).toBeNull();
    expect(screen.getAllByText('--').length).toBeGreaterThan(0);
  });

  it('renders the pooled All weeks row', () => {
    const data = {
      checkpoints: [1, 3, 7, 14, 28],
      cohorts: [
        { cohort_week: '2026-11-02', signups: 41, days: DAYS_NONE },
      ],
      all_weeks: { days: { ...DAYS_NONE, '7': { pct: 20, hit: 8, aged: 40 } } },
    };
    render(<DayNRetentionTable data={data} loading={false} error={null} onRefresh={vi.fn()} />);
    expect(screen.getByText('All weeks')).toBeTruthy();
    expect(screen.getByText('20.00% (8 of 40)')).toBeTruthy();
  });

  it('shows the empty state when there are no cohorts', () => {
    const data = { checkpoints: [1, 3, 7, 14, 28], cohorts: [], all_weeks: { days: DAYS_NONE } };
    render(<DayNRetentionTable data={data} loading={false} error={null} onRefresh={vi.fn()} />);
    expect(screen.getByText('No signup cohorts available.')).toBeTruthy();
  });
});
