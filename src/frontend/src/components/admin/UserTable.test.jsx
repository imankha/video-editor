import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { UserTable } from './UserTable';

const BASE_USER = {
  user_id: 'u1',
  email: 'user@test.com',
  origin: 'organic',
  last_step: 'Signed Up',
  acquired_at: '2026-08-20',
  clip_created_count: 0,
  export_completed_count: 0,
  share_completed_count: 0,
  credits: 0,
  credits_spent: 0,
  credits_purchased: 0,
  total_spent_cents: 0,
  action_count: 0,
  session_count: 0,
  total_usage_seconds: 0,
  avg_weekly_seconds: 0,
  last_7d_seconds: 0,
  last_active_at: null,
};

describe('UserTable Games column (T8220 tries vs succeeded)', () => {
  it('renders the bknoto shape (15 tried / 1 succeeded), never a bare attempt count', () => {
    const users = [
      { ...BASE_USER, user_id: 'bknoto', email: 'bknoto@gmail.com', game_created_count: 15, game_upload_succeeded_count: 1 },
    ];
    render(<UserTable users={users} onUserClick={() => {}} funnelTotals={{}} />);

    expect(screen.getByText('15 tried / 1 succeeded')).toBeTruthy();
    // The old bare-count behavior (a lone "15") must not be what's shown.
    expect(screen.queryByText('15')).toBeNull();
  });

  it('renders the chenyh1225 shape (7 tried / 0 succeeded) with the zero explicit, not omitted', () => {
    const users = [
      { ...BASE_USER, user_id: 'chenyh1225', email: 'chenyh1225@gmail.com', game_created_count: 7, game_upload_succeeded_count: 0 },
    ];
    render(<UserTable users={users} onUserClick={() => {}} funnelTotals={{}} />);

    expect(screen.getByText('7 tried / 0 succeeded')).toBeTruthy();
  });
});

describe('UserTable Clips Saved column (T8240 relabel)', () => {
  it('labels the clip_created_count column "Clips Saved", not "Clips" or "Published"', () => {
    render(<UserTable users={[BASE_USER]} onUserClick={() => {}} funnelTotals={{}} />);

    // The header reads "Clips Saved" (activity/save events), which honestly
    // describes clip_created_count and does not claim to be published output.
    expect(screen.getByText('Clips Saved')).toBeTruthy();
    expect(screen.queryByText('Clips')).toBeNull();
    expect(screen.queryByText('Published')).toBeNull();
  });

  it('still renders clip_created_count in the Clips Saved cell (metric unchanged)', () => {
    const users = [{ ...BASE_USER, clip_created_count: 12 }];
    render(<UserTable users={users} onUserClick={() => {}} funnelTotals={{}} />);

    expect(screen.getByText('12')).toBeTruthy();
  });
});

describe('UserTable Exports split (T8230 Focus / Overlay)', () => {
  it('renders Focus and Overlay columns alongside the retained Exports total', () => {
    const users = [
      {
        ...BASE_USER,
        user_id: 'bknoto',
        email: 'bknoto@gmail.com',
        game_created_count: 0,
        game_upload_succeeded_count: 0,
        export_completed_count: 9,   // total (Focus + Overlay + other/recovered)
        framing_exported_count: 4,   // Focus
        overlay_exported_count: 3,   // Overlay
      },
    ];
    render(<UserTable users={users} onUserClick={() => {}} funnelTotals={{}} />);

    // The header still carries the grand total plus the two new per-type columns.
    expect(screen.getByText('Exports')).toBeTruthy();
    expect(screen.getByText('Focus')).toBeTruthy();
    expect(screen.getByText('Overlay')).toBeTruthy();

    // Total is retained (so the 2 "other"/recovered exports are never dropped)
    // and each per-type count renders as its own cell.
    expect(screen.getByText('9')).toBeTruthy();
    expect(screen.getByText('4')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
  });

  it('renders 0 for the split when a user has exports but no per-type rows', () => {
    const users = [
      {
        ...BASE_USER,
        user_id: 'u1',
        game_created_count: 0,
        game_upload_succeeded_count: 0,
        export_completed_count: 1,
        framing_exported_count: 0,
        overlay_exported_count: 0,
      },
    ];
    render(<UserTable users={users} onUserClick={() => {}} funnelTotals={{}} />);

    // Focus/Overlay show explicit zeros, not a blank or the total.
    const zeros = screen.getAllByText('0');
    expect(zeros.length).toBeGreaterThanOrEqual(2);
  });
});
