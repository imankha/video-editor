import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { ChannelsTable } from './ChannelsTable';
import { CohortGrid } from './CohortGrid';
import { BuildsGrid } from './BuildsGrid';

// T13990: the three dimension tables show ONE column set; only the label differs.
const KPIS = {
  signups: 3, deleted: 0, revenue_cents: 1234, upload_success_pct: 75,
  first_highlight_14d: { aged: 24, hit: 3, pct: 12.5 }, upload_attempted: 7, upload_succeeded: 5, paywall_shown: 4, buy_modal_opened: 2, payers: 1,
  // T16340: the tries column shows the counts the rate divides (3 / 4 = 75%), not user counts.
  upload_tries: 4, upload_successes: 3,
  uploaded_pct: 67, clipped_pct: 33, exported_pct: 33, shared_pct: 0, purchased_pct: 33,
};
// T15290: Deleted sits right after Signups (account deleted, analytics kept).
const KPI_HEADERS = ['Signups', 'Deleted', 'Revenue', 'Upload Success', 'Upload tries', 'First highlight 14d', 'Paywall', 'Opened buy', 'Payers', 'Uploaded', 'Clipped', 'Exported', 'Shared', 'Purchased'];

const TABLES = [
  ['Campaigns', <ChannelsTable key="c" data={{ channels: [{ origin: 'tiktok', campaign_name: null, ...KPIS }] }} />, 'Campaign'],
  ['Cohorts', <CohortGrid key="h" data={{ cohorts: [{ cohort_period: '2026-10-05', ...KPIS }] }} />, 'Cohort'],
  ['Builds', <BuildsGrid key="b" data={{ builds: [{ build: 4812, commit_sha: 'abc1234def', first_signup_at: '2026-10-29T00:00:00+00:00', ...KPIS }] }} />, 'Build'],
];

function headers(container) {
  return [...container.querySelectorAll('th')].map(th => th.textContent);
}

describe('Dimension tables share one KPI column set (T13990)', () => {
  it.each(TABLES)('%s: label column then the shared KPI columns', (_name, table, labelHeader) => {
    const { container } = render(table);
    expect(headers(container)).toEqual([labelHeader, ...KPI_HEADERS]);
  });

  it.each(TABLES)('%s: renders the KPI values the same way', (_name, table) => {
    const { container } = render(table);
    const cells = [...container.querySelectorAll('tbody tr:first-child td')].slice(1).map(td => td.textContent);
    expect(cells).toEqual(['3', '0', '$12.34', '75.00%', '4 / 3', '12.50% (3/24)', '4', '2', '1', '67.00%', '33.00%', '33.00%', '0.00%', '33.00%']);
  });

  it('T16340: Upload tries explains the rate it shares counts with', () => {
    const { container } = render(<CohortGrid data={{ cohorts: [{ cohort_period: '2026-10-05', ...KPIS }] }} />);
    const th = [...container.querySelectorAll('th')].find(h => h.textContent === 'Upload tries');
    expect(th.getAttribute('title')).toMatch(/success with no recorded try counts as a try/);
  });

  it('upload success with no upload outcome reads "--"', () => {
    render(<CohortGrid data={{ cohorts: [{ cohort_period: '2026-10-05', ...KPIS, upload_success_pct: null }] }} />);
    expect(screen.getByText('--')).toBeTruthy();
  });

  it('T15290: shows a nonzero deleted count', () => {
    const { container } = render(
      <ChannelsTable data={{ channels: [{ origin: 'tiktok', campaign_name: null, ...KPIS, deleted: 5 }] }} />
    );
    const cells = [...container.querySelectorAll('tbody tr:first-child td')].map(td => td.textContent);
    expect(cells).toContain('5');
  });

  it('a row click passes the row key; the selected row is highlighted', () => {
    const onRowClick = vi.fn();
    const { container } = render(
      <CohortGrid data={{ cohorts: [{ cohort_period: '2026-10-05', ...KPIS }] }} onRowClick={onRowClick} selectedPeriod="2026-10-05" />
    );
    fireEvent.click(screen.getByText('2026-10-05'));
    expect(onRowClick).toHaveBeenCalledWith('2026-10-05');
    expect(container.querySelector('tbody tr').className).toContain('bg-purple-500/15');
  });
});

describe('DimensionTable read-out cells (T15120)', () => {
  const renderRow = (fh) => render(
    <ChannelsTable data={{ channels: [{ origin: 'tiktok', campaign_name: null, ...KPIS, first_highlight_14d: fh }] }} />,
  );

  it('shows the aged count beside the rate, full colour from 20 aged', () => {
    renderRow({ aged: 20, hit: 3, pct: 15 });
    expect(screen.getByText(/3\/20/).className).not.toContain('text-gray-500');
  });

  it('greys the rate under 20 aged so small N reads as small N', () => {
    renderRow({ aged: 19, hit: 3, pct: 15.79 });
    expect(screen.getByText(/3\/19/).className).toContain('text-gray-500');
  });

  it('shows no rate with nobody aged yet', () => {
    renderRow({ aged: 0, hit: 0, pct: null });
    expect(screen.getByTitle('No sign-ups 14 days old yet').textContent).toBe('--');
  });
});
