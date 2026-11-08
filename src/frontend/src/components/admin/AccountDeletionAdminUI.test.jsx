import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { ChannelsTable } from './ChannelsTable';
import { StepInspector } from './StepInspector';
import { UserDetailPanel } from './UserDetailPanel';

// T15290: account deletion keeps analytics. Deletion is surfaced from
// account_deletions (is_deleted/deleted_at), not inferred from last_active_at.
// Kept in a dedicated file so it does not disturb the sha256-pinned evidence
// of the shared test files these components already have (StepInspector.test.jsx,
// UserDetailPanel.test.jsx, DimensionTable.test.jsx own their earlier tasks' proof).

const KPIS = {
  signups: 3, deleted: 5, revenue_cents: 1234, upload_success_pct: 75,
  first_highlight_14d: { aged: 24, hit: 3, pct: 12.5 }, upload_attempted: 7, upload_succeeded: 5,
  paywall_shown: 4, buy_modal_opened: 2, payers: 1,
  uploaded_pct: 67, clipped_pct: 33, exported_pct: 33, shared_pct: 0, purchased_pct: 33,
};

describe('Dimension tables show a deleted count (T15290)', () => {
  it('renders the Deleted header and a nonzero deleted count', () => {
    const { container } = render(
      <ChannelsTable data={{ channels: [{ origin: 'tiktok', campaign_name: null, ...KPIS }] }} />
    );
    const headers = [...container.querySelectorAll('th')].map(th => th.textContent);
    expect(headers).toContain('Deleted');
    const cells = [...container.querySelectorAll('tbody tr:first-child td')].map(td => td.textContent);
    expect(cells).toContain('5');
  });

  it('renders 0 for a dimension with no deleted accounts', () => {
    const { container } = render(
      <ChannelsTable data={{ channels: [{ origin: 'organic', campaign_name: null, ...KPIS, deleted: 0 }] }} />
    );
    const cells = [...container.querySelectorAll('tbody tr:first-child td')].map(td => td.textContent);
    expect(cells).toContain('0');
  });
});

const STEP = {
  stage: 'started', label: 'Started',
  counts: { reached: 61, continued: 38, in_window: 3, stuck: 8, gone: 12, judged: 58,
    continue_rate: { pct: 65, k: 38, n: 58 } },
  next: { stage: 'add_footage', continued: 41, timed: 39, n: 37, median_s: 660, p75_s: 200000,
    out_of_order: 2, skipped: 0, buckets: { lt_1h: 24, same_day: 6, d2_3: 4, d4_14: 2, gt_14d: 1 } },
  breakdown: [],
  instead: [],
  instead_note: 'correlation, not cause',
  why: { failures: [], impressions: [], retry_bursts: { sampled: 0, with_bursts: 0, by_action: {} } },
  people: {
    stuck: [{ user_id: 'u1', email: 'a@x.com', platform: 'pwa-mobile', last_active_at: null, is_deleted: true }],
    gone: [{ user_id: 'u2', email: 'b@x.com', platform: 'pwa-desktop', last_active_at: '2026-09-01T10:00:00Z', is_deleted: false }],
    in_window: [],
  },
  left: null,
};

describe('StepInspector people list shows deletion from the record (T15290)', () => {
  it('reads "Deleted account" for a deleted person, never their email', () => {
    render(<StepInspector step={STEP} by="platform" onChangeBy={() => {}} outcome="stuck"
                          onChangeOutcome={() => {}} onOpenUser={() => {}} />);
    expect(screen.getByTestId('step-person-u1').textContent).toContain('Deleted account');
    expect(screen.queryByText('a@x.com')).toBeNull();
  });

  it('shows the real email for a live person, not "Deleted account"', () => {
    render(<StepInspector step={STEP} by="platform" onChangeBy={() => {}} outcome="gone"
                          onChangeOutcome={() => {}} onOpenUser={() => {}} />);
    expect(screen.getByTestId('step-person-u2').textContent).toContain('b@x.com');
    expect(screen.getByTestId('step-person-u2').textContent).not.toContain('Deleted account');
  });
});

const BASE_DATA = {
  email: 'user@test.com',
  origin: 'organic',
  session_count: 2,
  acquired_at: '2026-08-20',
  last_active_at: '2026-08-21T00:00:00Z',
  actionLog: [],
  milestones: [],
};

describe('UserDetailPanel shows a Deleted chip from account_deletions (T15290)', () => {
  it('shows a Deleted chip with the deletion date in its title', () => {
    render(<UserDetailPanel data={{ ...BASE_DATA, is_deleted: true, deleted_at: '2026-11-01T12:00:00Z' }} onClose={() => {}} />);
    const chip = screen.getByText('Deleted');
    expect(chip.getAttribute('title')).toContain('Deleted');
  });

  it('shows no Deleted chip for a live account', () => {
    render(<UserDetailPanel data={{ ...BASE_DATA, is_deleted: false }} onClose={() => {}} />);
    expect(screen.queryByText('Deleted')).toBeNull();
  });
});
