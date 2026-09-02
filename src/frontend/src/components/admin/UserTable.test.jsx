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
