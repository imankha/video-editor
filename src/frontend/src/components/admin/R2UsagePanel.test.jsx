import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { R2UsagePanel } from './R2UsagePanel';

const ROUTE = 'PUT /api/clips/raw/{clip_id}';

const RESPONSE = {
  generated_at: '2026-10-29T12:00:00+00:00',
  coverage: 'server-side boto3 calls only; excludes Modal and presigned-URL traffic',
  partial: true,
  cycle: { start: '2026-10-18', end: '2026-11-17', elapsed_days: 11.5,
           class_a: 250000, class_b: 90000, free_tier_class_a: 1000000, projected_class_a: 652174 },
  daily: [
    { day: '2026-10-29', env: 'production', source: ROUTE, class_a: 12, class_b: 3, free: 0, unclassified: 0 },
    { day: '2026-10-29', env: 'production', source: 'untagged', class_a: 2, class_b: 0, free: 9, unclassified: 0 },
    { day: '2026-10-28', env: 'production', source: ROUTE, class_a: 30, class_b: 5, free: 0, unclassified: 0 },
    { day: '2026-10-28', env: 'staging', source: 'sweep', class_a: 400, class_b: 1, free: 0, unclassified: 0 },
  ],
  today_top: [
    { env: 'production', source: ROUTE, class_a: 12, class_b: 3 },
    { env: 'production', source: 'untagged', class_a: 2, class_b: 0 },
  ],
  shards: [
    { env: 'production', writer: 'm1', last_modified: '2026-10-29T11:30:00+00:00', schema: 1, error: null },
    { env: 'production', writer: 'm2', last_modified: '2026-10-29T08:00:00+00:00', schema: 1, error: null },
    { env: 'staging', writer: 's1', last_modified: '2026-10-29T11:00:00+00:00', schema: null, error: 'unreadable' },
  ],
};

const renderPanel = (props = {}) =>
  render(<R2UsagePanel data={RESPONSE} loading={false} error={null} onRefresh={vi.fn()} {...props} />);

describe('R2UsagePanel (T13931) -- pure view', () => {
  it('renders a Load button and no table before a fetch, and loads on click', () => {
    const onRefresh = vi.fn();
    render(<R2UsagePanel data={null} loading={false} error={null} onRefresh={onRefresh} />);
    expect(screen.queryByText('untagged')).toBeNull();
    fireEvent.click(screen.getByText('Load R2 usage'));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('renders 30-day env/source totals with Class A and B summed across days', () => {
    renderPanel();
    const row = screen.getByTestId(`r2-source-production|${ROUTE}`);
    expect(within(row).getByText('42')).toBeTruthy(); // 12 + 30 Class A
    expect(within(row).getByText('8')).toBeTruthy();  // 3 + 5 Class B
    expect(screen.getByTestId('r2-source-staging|sweep')).toBeTruthy();
  });

  it('expands a source into its per-day rows on click', () => {
    renderPanel();
    expect(screen.queryByTestId(`r2-day-production|${ROUTE}|2026-10-28`)).toBeNull();
    fireEvent.click(screen.getByTestId(`r2-source-production|${ROUTE}`));
    expect(screen.getByTestId(`r2-day-production|${ROUTE}|2026-10-28`)).toBeTruthy();
  });

  it('highlights untagged/unmatched sources as fix-me signals, and only those', () => {
    renderPanel();
    expect(screen.getByTestId('r2-source-production|untagged').dataset.fixme).toBe('true');
    expect(screen.getByTestId(`r2-source-production|${ROUTE}`).dataset.fixme).toBe('false');
  });

  it('shows cycle-to-date Class A vs the 1,000,000 free tier, the projection, and the coverage caveat', () => {
    renderPanel();
    expect(screen.getByText(/250,000 \/ 1,000,000 Class A/)).toBeTruthy();
    expect(screen.getByText(/652,174/)).toBeTruthy();
    expect(screen.getByText(/2026-10-18 to 2026-11-17/)).toBeTruthy();
    expect(screen.getByText(/server-side boto3 calls only/)).toBeTruthy();
  });

  it('lists today top sources', () => {
    renderPanel();
    const top = screen.getByTestId('r2-today-top');
    expect(within(top).getAllByRole('listitem')).toHaveLength(2);
    expect(within(top).getAllByRole('listitem')[0].textContent).toContain(ROUTE);
  });

  it('flags shards older than 2h and unreadable shards, and marks the result partial', () => {
    renderPanel();
    expect(screen.getByTestId('r2-shard-production|m2').textContent).toMatch(/stale/);
    expect(screen.getByTestId('r2-shard-production|m1').textContent).not.toMatch(/stale/);
    expect(screen.getByTestId('r2-shard-staging|s1').textContent).toMatch(/unreadable/);
    expect(screen.getByText(/Partial result/)).toBeTruthy();
  });

  it('shows the error message when present', () => {
    render(<R2UsagePanel data={null} loading={false} error="Admin access required" onRefresh={vi.fn()} />);
    expect(screen.getByText('Error: Admin access required')).toBeTruthy();
  });
});
