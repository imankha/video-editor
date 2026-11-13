import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { RetentionView } from './RetentionView';

function baseData(overrides = {}) {
  return {
    coverage_start: '2026-06-01',
    triangle: {
      weeks_tracked: 2,
      cohorts: [
        {
          cohort_week: '2026-11-02',
          signups: 41,
          small_n: false,
          weeks: {
            '0': { classic: { pct: 100, hit: 41, aged: 41 }, unbounded: { pct: 100, hit: 41, aged: 41 } },
            '1': { classic: { pct: 12.2, hit: 5, aged: 41 }, unbounded: { pct: 30, hit: 12, aged: 41 } },
          },
        },
      ],
    },
    wau: [{ week: '2026-11-02', wau: 50, mau: 150, wau_mau_ratio: 0.33, low_volume: false }],
    low_volume_rule: { ratio: 0.5, trailing_weeks: 12 },
    return_after_gap: { gap_days: 120, cohorts: [{ month: '2026-06-01', cohort_size: 20, pct: null, hit: null, aged: null }] },
    action: null,
    ...overrides,
  };
}

describe('RetentionView (T7430)', () => {
  it('renders the unbounded view by default, not the classic rate', () => {
    render(<RetentionView data={baseData()} loading={false} error={null} onRefresh={vi.fn()} action="" onActionChange={vi.fn()} />);
    expect(screen.getByText('30.00%')).toBeTruthy();
    expect(screen.queryByText('12.20%')).toBeNull();
  });

  it('shows a small-N cohort as a raw fraction, not a %', () => {
    const data = baseData();
    data.triangle.cohorts[0].small_n = true;
    render(<RetentionView data={data} loading={false} error={null} onRefresh={vi.fn()} action="" onActionChange={vi.fn()} />);
    expect(screen.getByText('12/41')).toBeTruthy();
  });

  it('shows the unmeasurable return-after-gap month as a message, not a fabricated 0%', () => {
    render(<RetentionView data={baseData()} loading={false} error={null} onRefresh={vi.fn()} action="" onActionChange={vi.fn()} />);
    expect(screen.getByText(/No month has matured/)).toBeTruthy();
  });

  it('shows the action not-available message when the rollup has not run', () => {
    const data = baseData({ action: { action: 'export_completed', cohorts: [], available: false } });
    render(<RetentionView data={data} loading={false} error={null} onRefresh={vi.fn()} action="export_completed" onActionChange={vi.fn()} />);
    expect(screen.getByText(/Run the action rollup first/)).toBeTruthy();
  });

  it('shows the empty state when there is no data yet', () => {
    render(<RetentionView data={null} loading={false} error={null} onRefresh={vi.fn()} action="" onActionChange={vi.fn()} />);
    expect(screen.getByText('Load retention chart')).toBeTruthy();
  });

  // T16070 (ruling 2026-11-13): the Day N figures live in the chart's hover, not a table.
  it('hovering a cohort curve shows that cohort\'s day 1/3/7/14/28 figures, blank when not yet measurable', () => {
    const data = baseData({
      day_n: {
        checkpoints: [1, 3, 7, 14, 28],
        cohorts: [{
          cohort_week: '2026-11-02',
          signups: 41,
          days: {
            '1': { pct: 12.2, hit: 5, aged: 41 },
            '3': { pct: 9.76, hit: 4, aged: 41 },
            '7': { pct: 4.88, hit: 2, aged: 41 },
            '14': null,
            '28': null,
          },
        }],
        all_weeks: { days: {} },
      },
    });
    render(<RetentionView data={data} loading={false} error={null} onRefresh={vi.fn()} action="" onActionChange={vi.fn()} />);
    expect(screen.queryByTestId('retention-hover')).toBeNull();
    fireEvent.mouseEnter(screen.getByTestId('retention-curve'));
    const hover = within(screen.getByTestId('retention-hover'));
    expect(hover.getByText('2026-11-02')).toBeTruthy();
    expect(hover.getByText('Day 1')).toBeTruthy();
    expect(hover.getByText('12.20% (5 of 41)')).toBeTruthy();
    expect(hover.getByText('4.88% (2 of 41)')).toBeTruthy();
    expect(hover.getAllByText('not yet measurable')).toHaveLength(2);
    expect(hover.queryByText('Day 0')).toBeNull();
  });
});
