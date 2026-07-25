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
