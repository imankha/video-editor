import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { RetentionView } from './RetentionView';

function baseData(overrides = {}) {
  return {
    group: 'cohorts',
    coverage_start: '2026-06-01',
    triangle: {
      weeks_tracked: 2,
      cohorts: [
        {
          group: '2026-11-02',
          label: '2026-11-02',
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

const renderView = (data, props = {}) => render(
  <RetentionView data={data} loading={false} error={null} onRefresh={vi.fn()} action="" onActionChange={vi.fn()} {...props} />,
);

// Points paint in week order per curve; index 1 is week 1 of the first curve.
const hoverPoint = (i) => fireEvent.mouseEnter(screen.getAllByTestId('retention-point')[i]);

describe('RetentionView (T7430)', () => {
  // Ruling 2026-11-13: the chart is the only thing on screen -- no table.
  it('renders one large chart and no table', () => {
    const data = baseData({
      return_after_gap: { gap_days: 120, cohorts: [{ month: '2026-01-01', cohort_size: 20, pct: 25, hit: 5, aged: 20 }] },
    });
    renderView(data);
    expect(screen.getByRole('img', { name: 'Retention curves' })).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('hovering a point shows its exact percent and counts; unbounded by default', () => {
    renderView(baseData());
    expect(screen.queryByTestId('retention-hover')).toBeNull();
    hoverPoint(1);
    const hover = within(screen.getByTestId('retention-hover'));
    expect(hover.getByText('Week 1: 30.00% (12 of 41)')).toBeTruthy();
  });

  it('the classic toggle changes the hovered figure', () => {
    renderView(baseData());
    fireEvent.click(screen.getByLabelText('Classic'));
    hoverPoint(1);
    expect(within(screen.getByTestId('retention-hover')).getByText('Week 1: 12.20% (5 of 41)')).toBeTruthy();
  });

  it('a small-N group shows the raw fraction, not a %', () => {
    const data = baseData();
    data.triangle.cohorts[0].small_n = true;
    renderView(data);
    hoverPoint(1);
    expect(within(screen.getByTestId('retention-hover')).getByText('Week 1: 12/41')).toBeTruthy();
  });

  it('labels each curve with its group, so Campaigns compare campaigns', () => {
    const data = baseData({ group: 'campaigns' });
    Object.assign(data.triangle.cohorts[0], { group: 'camp_9', label: 'Spring promo' });
    delete data.triangle.cohorts[0].cohort_week;
    renderView(data);
    expect(screen.getByText(/Comparing campaigns/)).toBeTruthy();
    expect(screen.getByTestId('retention-legend').textContent).toContain('Spring promo');
  });

  it('shows the unmeasurable return-after-gap month as a message, not a fabricated 0%', () => {
    renderView(baseData());
    expect(screen.getByText(/No month has matured/)).toBeTruthy();
  });

  it('shows the action not-available message when the rollup has not run', () => {
    renderView(baseData({ action: { action: 'export_completed', cohorts: [], available: false } }), { action: 'export_completed' });
    expect(screen.getByText(/Run the action rollup first/)).toBeTruthy();
  });

  it('plots action-level retention as curves when an action is chosen', () => {
    const data = baseData({
      action: {
        action: 'export_completed', available: true,
        cohorts: [{ cohort_week: '2026-10-26', base: 10, weeks: { '0': { pct: 100, hit: 10, aged: 10 }, '1': { pct: 40, hit: 4, aged: 10 } } }],
      },
    });
    renderView(data, { action: 'export_completed' });
    expect(screen.getAllByTestId('retention-action-curve')).toHaveLength(1);
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('the weekly/monthly toggle asks for the other cohort bin', () => {
    const onCohortBinChange = vi.fn();
    renderView(baseData(), { cohortBin: 'week', onCohortBinChange });
    fireEvent.click(screen.getByLabelText('Monthly'));
    expect(onCohortBinChange).toHaveBeenCalledWith('month');
  });

  it('the weekly/monthly toggle only applies to the Cohorts grouping', () => {
    renderView(baseData({ group: 'builds' }), { cohortBin: 'week', onCohortBinChange: vi.fn() });
    expect(screen.getByLabelText('Monthly').disabled).toBe(true);
  });

  it('shows the empty state when there is no data yet', () => {
    renderView(null);
    expect(screen.getByText('Load retention chart')).toBeTruthy();
  });

  // T16070 (ruling 2026-11-13): the Day N figures live in the chart's hover, not a table.
  it('hovering a curve shows that group\'s day 1/3/7/14/28 figures, blank when not yet measurable', () => {
    const data = baseData({
      day_n: {
        checkpoints: [1, 3, 7, 14, 28],
        cohorts: [{
          group: '2026-11-02',
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
    renderView(data);
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
