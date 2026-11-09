import { render, screen, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { BySportTable, groupBySportByMonth } from './BySportTable';

describe('groupBySportByMonth (T14950)', () => {
  it('keeps unrecorded and no_sport as separate rows and sorts by exports descending', () => {
    const rows = [
      { month: '2026-09', sport: 'basketball', action: 'credits_consumed', events: 5, distinct_users: 4 },
      { month: '2026-09', sport: 'unrecorded', action: 'credits_consumed', events: 2, distinct_users: 2 },
      { month: '2026-09', sport: 'no_sport', action: 'credits_consumed', events: 7, distinct_users: 3 },
      // a non-export action in the same rollup must be excluded.
      { month: '2026-09', sport: 'basketball', action: 'clip_created', events: 100, distinct_users: 10 },
    ];
    const months = groupBySportByMonth(rows);
    expect(months).toEqual([
      { month: '2026-09', sports: [
        { sport: 'no_sport', exports: 7, distinctUsers: 3 },
        { sport: 'basketball', exports: 5, distinctUsers: 4 },
        { sport: 'unrecorded', exports: 2, distinctUsers: 2 },
      ] },
    ]);
  });
});

describe('BySportTable (T14950)', () => {
  it('renders one block per month, a sport row per sport, and the overlap note', () => {
    const data = {
      rows: [
        { month: '2026-09', sport: 'basketball', action: 'credits_consumed', events: 5, distinct_users: 4 },
        { month: '2026-09', sport: 'unrecorded', action: 'credits_consumed', events: 2, distinct_users: 2 },
        { month: '2026-09', sport: 'no_sport', action: 'credits_consumed', events: 7, distinct_users: 3 },
      ],
    };
    render(<BySportTable data={data} loading={false} error={null} onRefresh={vi.fn()} />);
    const sept = within(screen.getByTestId('by-sport-month-2026-09'));
    expect(sept.getByText('basketball')).toBeTruthy();
    expect(sept.getByText('unrecorded')).toBeTruthy();
    expect(sept.getByText('no_sport')).toBeTruthy();
    expect(screen.getByTestId('by-sport-overlap-note').textContent).toMatch(/overlap/);
  });

  it('shows the empty state when there is no export data yet', () => {
    render(<BySportTable data={{ rows: [] }} loading={false} error={null} onRefresh={vi.fn()} />);
    expect(screen.getByText('No export data yet.')).toBeTruthy();
  });
});
