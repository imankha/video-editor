import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ActivationReport } from './ActivationReport';

function baseData(overrides = {}) {
  return {
    window_days: 14,
    benchmarks: { export_completed: { target: 40, median: 30, great: 50 } },
    group: 'cohorts',
    cohorts: [
      {
        group: '2026-05-01',
        label: '2026-05-01',
        cohort_month: '2026-05-01',
        signups: 20,
        maturing: false,
        export_completed: { pct: 45, hit: 9, aged: 20 },
        share_completed: { pct: 30, hit: 6, aged: 20 },
      },
    ],
    ...overrides,
  };
}

describe('ActivationReport (T7420)', () => {
  it('renders both the export and share rates for a matured cohort', () => {
    render(<ActivationReport data={baseData()} loading={false} error={null} onRefresh={vi.fn()} />);
    expect(screen.getByText((text) => text.startsWith('45.00%'))).toBeTruthy();
    expect(screen.getByText((text) => text.startsWith('30.00%'))).toBeTruthy();
  });

  it('shows a maturing cohort labeled, with metrics blank -- never a fabricated 0%', () => {
    const data = baseData({
      cohorts: [{ group: '2026-11-01', label: '2026-11-01', cohort_month: '2026-11-01', signups: 5, maturing: true, export_completed: null, share_completed: null }],
    });
    render(<ActivationReport data={data} loading={false} error={null} onRefresh={vi.fn()} />);
    expect(screen.getByTestId('maturing-label')).toBeTruthy();
    expect(screen.queryByText('0.00%')).toBeNull();
  });

  it('prints the export benchmark caption', () => {
    render(<ActivationReport data={baseData()} loading={false} error={null} onRefresh={vi.fn()} />);
    expect(screen.getByText(/40.00% target/)).toBeTruthy();
  });

  it('shows the empty state when there is no data yet', () => {
    render(<ActivationReport data={null} loading={false} error={null} onRefresh={vi.fn()} />);
    expect(screen.getByText('Load activation')).toBeTruthy();
  });

  it('shows "no cohorts" when the report returns none', () => {
    render(<ActivationReport data={baseData({ cohorts: [] })} loading={false} error={null} onRefresh={vi.fn()} />);
    expect(screen.getByText('No signup cohorts available.')).toBeTruthy();
  });

  it('groups by the Dimension pill: one row per campaign, labelled by name (ruling 2026-11-13)', () => {
    const data = baseData({
      group: 'campaigns',
      cohorts: [
        { group: 'c1', label: 'Spring Promo', signups: 4, maturing: false, export_completed: { pct: 50, hit: 2, aged: 4 }, share_completed: null },
        { group: 'organic', label: 'organic', signups: 9, maturing: true, export_completed: null, share_completed: null },
      ],
    });
    render(<ActivationReport data={data} loading={false} error={null} onRefresh={vi.fn()} />);
    expect(screen.getByRole('columnheader', { name: 'Campaign' })).toBeTruthy();
    const rows = screen.getAllByTestId('activation-cohort-row');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('Spring Promo');
    expect(screen.getByText(/by campaign/)).toBeTruthy();
  });

  it('labels the Builds grouping as signup build', () => {
    const data = baseData({
      group: 'builds',
      cohorts: [{ group: '9431', label: '9431', signups: 3, maturing: false, export_completed: null, share_completed: null }],
    });
    render(<ActivationReport data={data} loading={false} error={null} onRefresh={vi.fn()} />);
    expect(screen.getByRole('columnheader', { name: 'Signup build' })).toBeTruthy();
  });
});
