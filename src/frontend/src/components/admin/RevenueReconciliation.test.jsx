import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { RevenueReconciliation } from './RevenueReconciliation';
import { useAdminStore } from '../../stores/adminStore';

// Stub creditStore (imported transitively by adminStore) so nothing hits network.
vi.mock('../../stores/creditStore', () => ({
  useCreditStore: { getState: () => ({ fetchCredits: vi.fn() }) },
}));

const REPORT = {
  rows: [
    { user_id: 'user-a', email: 'a@x.com', local_cents: 699, stripe_net_cents: 399,
      delta_cents: 300, cause: 'refund', pi_count: 1, has_pending_dispute: false, drifted: true },
    { user_id: 'user-c', email: 'c@x.com', local_cents: 999, stripe_net_cents: 0,
      delta_cents: 999, cause: 'test_mode_era', pi_count: 0, has_pending_dispute: false, drifted: true },
    { user_id: 'user-b', email: 'b@x.com', local_cents: 399, stripe_net_cents: 399,
      delta_cents: 0, cause: 'aligned', pi_count: 1, has_pending_dispute: false, drifted: false },
  ],
  summary: { total_users: 3, drifted_users: 2, aligned_users: 1,
             total_local_cents: 2097, total_stripe_net_cents: 798, total_delta_cents: 1198 },
  go_live_date: '2026-07-22',
};

describe('RevenueReconciliation panel (T5760)', () => {
  beforeEach(() => {
    useAdminStore.setState({
      reconciliationData: null, reconciliationLoading: false, reconciliationError: null,
      reconciliationHealResults: {},
      fetchReconciliation: vi.fn(), healReconciliation: vi.fn().mockResolvedValue({}),
    });
    vi.restoreAllMocks();
  });

  it('renders a Run button and no table before a run', () => {
    render(<RevenueReconciliation />);
    expect(screen.getByText('Run reconciliation')).toBeTruthy();
    expect(screen.queryByText('a@x.com')).toBeNull();
  });

  it('shows ONLY drifted users with their cause + delta once a report is loaded', () => {
    useAdminStore.setState({ reconciliationData: REPORT });
    render(<RevenueReconciliation />);

    // Drifted rows present.
    expect(screen.getByText('a@x.com')).toBeTruthy();
    expect(screen.getByText('c@x.com')).toBeTruthy();
    // Aligned user filtered out of the table.
    expect(screen.queryByText('b@x.com')).toBeNull();
    // Cause badges.
    expect(screen.getByText('Refund')).toBeTruthy();
    expect(screen.getByText('Test-mode era')).toBeTruthy();
  });

  it('heal button calls healReconciliation for that user after confirm', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const heal = vi.fn().mockResolvedValue({});
    useAdminStore.setState({ reconciliationData: REPORT, healReconciliation: heal });
    render(<RevenueReconciliation />);

    const perUser = screen.getAllByText('Adopt Stripe value');
    fireEvent.click(perUser[0]);
    expect(heal).toHaveBeenCalledWith({ userIds: ['user-a'] });
  });

  it('all-drifted heal button sends allDrifted', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const heal = vi.fn().mockResolvedValue({});
    useAdminStore.setState({ reconciliationData: REPORT, healReconciliation: heal });
    render(<RevenueReconciliation />);

    fireEvent.click(screen.getByText(/Adopt Stripe value for all/));
    expect(heal).toHaveBeenCalledWith({ allDrifted: true });
  });

  it('cancelling the confirm does not heal', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const heal = vi.fn();
    useAdminStore.setState({ reconciliationData: REPORT, healReconciliation: heal });
    render(<RevenueReconciliation />);

    fireEvent.click(screen.getAllByText('Adopt Stripe value')[0]);
    expect(heal).not.toHaveBeenCalled();
  });

  it('renders the account_deleted cause and an id-only deletion line (T8640)', () => {
    useAdminStore.setState({ reconciliationData: {
      rows: [
        { user_id: 'fb40690a-edcf-4504-a51f-f9df6f84ac4f', email: null, local_cents: 399,
          stripe_net_cents: 199, delta_cents: 200, cause: 'account_deleted', pi_count: 1,
          has_pending_dispute: false, account_exists: false, deleted_at: '2026-08-24', drifted: true },
      ],
      summary: { total_users: 1, drifted_users: 1, aligned_users: 0,
                 total_local_cents: 399, total_stripe_net_cents: 199, total_delta_cents: 200 },
      go_live_date: '2026-07-22',
    } });
    render(<RevenueReconciliation />);
    expect(screen.getByText('Account deleted')).toBeTruthy();
    expect(screen.getByText('account deleted 2026-08-24')).toBeTruthy();
  });

  it('renders "no local account" when a deleted-payer row has no deletion record (T8640)', () => {
    useAdminStore.setState({ reconciliationData: {
      rows: [
        { user_id: 'orphan-id', email: null, local_cents: 399, stripe_net_cents: 199,
          delta_cents: 200, cause: 'account_deleted', pi_count: 1, has_pending_dispute: false,
          account_exists: false, deleted_at: null, drifted: true },
      ],
      summary: { total_users: 1, drifted_users: 1, aligned_users: 0,
                 total_local_cents: 399, total_stripe_net_cents: 199, total_delta_cents: 200 },
      go_live_date: '2026-07-22',
    } });
    render(<RevenueReconciliation />);
    expect(screen.getByText('no local account')).toBeTruthy();
  });

  it('surfaces a failed heal on the row it failed for (T8640)', () => {
    useAdminStore.setState({
      reconciliationData: REPORT,
      reconciliationHealResults: {
        'user-a': { user_id: 'user-a', healed: false, skipped: 'account deleted; reconciled from ledger' },
      },
    });
    render(<RevenueReconciliation />);
    expect(screen.getByText(/Heal failed/)).toBeTruthy();
  });

  it('renders the all-reconciled state when nothing drifts', () => {
    useAdminStore.setState({ reconciliationData: {
      rows: [REPORT.rows[2]],
      summary: { total_users: 1, drifted_users: 0, aligned_users: 1,
                 total_local_cents: 399, total_stripe_net_cents: 399, total_delta_cents: 0 },
      go_live_date: '2026-07-22',
    } });
    render(<RevenueReconciliation />);
    expect(screen.getByText(/no drift against Stripe/)).toBeTruthy();
  });
});
