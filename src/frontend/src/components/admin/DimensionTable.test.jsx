import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { ChannelsTable } from './ChannelsTable';
import { CohortGrid } from './CohortGrid';
import { BuildsGrid } from './BuildsGrid';

// T13990: the three dimension tables show ONE column set; only the label differs.
const KPIS = {
  signups: 3, revenue_cents: 1234, upload_success_pct: 75,
  uploaded_pct: 67, clipped_pct: 33, exported_pct: 33, shared_pct: 0, purchased_pct: 33,
};
const KPI_HEADERS = ['Signups', 'Revenue', 'Upload Success', 'Uploaded', 'Clipped', 'Exported', 'Shared', 'Purchased'];

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
    expect(cells).toEqual(['3', '$12.34', '75%', '67%', '33%', '33%', '0%', '33%']);
  });

  it('upload success with no upload outcome reads "--"', () => {
    render(<CohortGrid data={{ cohorts: [{ cohort_period: '2026-10-05', ...KPIS, upload_success_pct: null }] }} />);
    expect(screen.getByText('--')).toBeTruthy();
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
