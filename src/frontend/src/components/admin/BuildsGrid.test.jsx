import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { BuildsGrid } from './BuildsGrid';

const ROW = {
  signups: 3, revenue_cents: 1000, upload_success_pct: 80,
  uploaded_pct: 50, clipped_pct: 40, exported_pct: 30, shared_pct: 20, purchased_pct: 10,
};
const DATA = {
  builds: [
    { ...ROW, build: 4812, commit_sha: 'abc1234def5678', first_signup_at: '2026-10-29T18:04:00+00:00' },
    { ...ROW, build: 'unrecorded', commit_sha: null, first_signup_at: '2026-01-02T00:00:00+00:00' },
  ],
  unattributed_revenue_cents: 0,
};

describe('BuildsGrid (T14000)', () => {
  it('labels each build "#<build> (<short sha>)" with its first-signup date', () => {
    render(<BuildsGrid data={DATA} />);
    expect(screen.getByText('#4812 (abc1234)')).toBeTruthy();
    expect(screen.getByText('2026-10-29')).toBeTruthy();
    expect(screen.getByText('Unrecorded')).toBeTruthy();
  });

  it('a build row click passes the build number; the unrecorded row is not selectable', () => {
    const onRowClick = vi.fn();
    render(<BuildsGrid data={DATA} onRowClick={onRowClick} />);
    fireEvent.click(screen.getByText('#4812 (abc1234)'));
    fireEvent.click(screen.getByText('Unrecorded'));
    expect(onRowClick.mock.calls).toEqual([[4812]]);
  });

  it('says the build is the server build at signup', () => {
    render(<BuildsGrid data={DATA} />);
    expect(screen.getByText('Build').getAttribute('title')).toContain('server');
  });

  it('shows an empty message when there are no rows', () => {
    render(<BuildsGrid data={{ builds: [], unattributed_revenue_cents: 0 }} />);
    expect(screen.getByText('No build data available.')).toBeTruthy();
  });
});
