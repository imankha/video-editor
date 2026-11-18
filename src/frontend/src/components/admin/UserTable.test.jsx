import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { UserTable } from './UserTable';
import { useAdminStore } from '../../stores/adminStore';

const BASE_USER = {
  user_id: 'u1',
  email: 'user@test.com',
  origin: 'organic',
  last_step: 'Signed Up',
  acquired_at: '2026-08-20',
  clip_created_count: 0,
  clip_tried_count: 0,
  clip_succeeded_count: 0,
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

describe('UserTable Games column (T8220 tries vs succeeded, T11010 per-file pair)', () => {
  it('renders the bknoto shape (15 / 1), never a bare attempt count', () => {
    const users = [
      { ...BASE_USER, user_id: 'bknoto', email: 'bknoto@gmail.com', game_tried_count: 15, game_succeeded_count: 1 },
    ];
    render(<UserTable users={users} onUserClick={() => {}} funnelTotals={{}} />);

    expect(screen.getByText('15 / 1')).toBeTruthy();
    // The old bare-count behavior (a lone "15") must not be what's shown.
    expect(screen.queryByText('15')).toBeNull();
  });

  it('renders the chenyh1225 shape (7 / 0) with the zero explicit, not omitted', () => {
    const users = [
      { ...BASE_USER, user_id: 'chenyh1225', email: 'chenyh1225@gmail.com', game_tried_count: 7, game_succeeded_count: 0 },
    ];
    render(<UserTable users={users} onUserClick={() => {}} funnelTotals={{}} />);

    expect(screen.getByText('7 / 0')).toBeTruthy();
  });

  it('drops the words "tried"/"succeeded" -- the slash carries that meaning (T11010)', () => {
    const users = [{ ...BASE_USER, game_tried_count: 4, game_succeeded_count: 4 }];
    render(<UserTable users={users} onUserClick={() => {}} funnelTotals={{}} />);

    expect(screen.getByText('4 / 4')).toBeTruthy();
    expect(screen.queryByText(/tried/)).toBeNull();
    expect(screen.queryByText(/succeeded/)).toBeNull();
  });

  it('reads the per-FILE game pair, never the per-GAME game_created_count (T11010)', () => {
    // The grain bug this fixes: game_created is one event per GAME while
    // game_upload_succeeded is one per VIDEO FILE, so a 5-angle game rendered
    // "1 / 5" -- success exceeding attempt. The cell must ignore
    // game_created_count (kept only as the sort/funnel dimension) entirely.
    const users = [{
      ...BASE_USER,
      game_created_count: 1,      // per GAME -- must NOT reach the cell
      game_tried_count: 5,        // per FILE
      game_succeeded_count: 5,
    }];
    render(<UserTable users={users} onUserClick={() => {}} funnelTotals={{}} />);

    expect(screen.getByText('5 / 5')).toBeTruthy();
    expect(screen.queryByText('1 / 5')).toBeNull();
  });
});

describe('UserTable Plays column (T8240 relabel, T17270 "Plays")', () => {
  it('labels the clip_created_count column "Plays", not "Clips" or "Published"', () => {
    render(<UserTable users={[BASE_USER]} onUserClick={() => {}} funnelTotals={{}} />);

    // T17270: the parent's word for a marked clip. Still not published output.
    expect(screen.getByText('Plays')).toBeTruthy();
    expect(screen.queryByText(/Clips/)).toBeNull();
    expect(screen.queryByText('Published')).toBeNull();
  });

  it('renders the clip tried/succeeded pair in the Clips Saved cell, never a bare count', () => {
    const users = [{ ...BASE_USER, clip_tried_count: 12, clip_succeeded_count: 9 }];
    render(<UserTable users={users} onUserClick={() => {}} funnelTotals={{}} />);

    expect(screen.getByText('12 / 9')).toBeTruthy();
    expect(screen.queryByText('12')).toBeNull();
  });

  it('sums both clip flows into "succeeded" (annotate-save + T8370 direct upload)', () => {
    // A user who only ever used the direct-upload flow: zero annotate-save
    // successes (clip_created), but clip_uploaded successes must still count.
    const users = [{ ...BASE_USER, clip_tried_count: 3, clip_succeeded_count: 3 }];
    render(<UserTable users={users} onUserClick={() => {}} funnelTotals={{}} />);

    expect(screen.getByText('3 / 3')).toBeTruthy();
  });
});

describe('UserTable render columns (T8230 split, T17270 Sharpens / Spotlights / Highlights)', () => {
  it('renders Sharpens and Spotlights columns and no double-counting Exports total', () => {
    const users = [
      {
        ...BASE_USER,
        user_id: 'bknoto',
        email: 'bknoto@gmail.com',
        game_tried_count: 0,
        game_succeeded_count: 0,
        export_completed_count: 9,   // total (Focus + Overlay + other/recovered)
        framing_exported_count: 4,   // Focus
        overlay_exported_count: 3,   // Overlay
      },
    ];
    render(<UserTable users={users} onUserClick={() => {}} funnelTotals={{}} />);

    // T17270: the Exports total counted a spotlight render twice; it is gone.
    expect(screen.queryByText('Exports')).toBeNull();
    expect(screen.getByText('Sharpens')).toBeTruthy();
    expect(screen.getByText('Spotlights')).toBeTruthy();

    expect(screen.queryByText('9')).toBeNull();
    expect(screen.getByText('4')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
  });

  it('renders 0 for the split when a user has exports but no per-type rows', () => {
    const users = [
      {
        ...BASE_USER,
        user_id: 'u1',
        game_tried_count: 0,
        game_succeeded_count: 0,
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

describe('UserTable deleted payer tombstone', () => {
  it('shows retained spend without exposing account actions', () => {
    const deleted = {
      ...BASE_USER,
      user_id: 'deleted-payer',
      email: 'Deleted account',
      is_deleted: true,
      total_spent_cents: 399,
    };
    render(<UserTable users={[deleted]} onUserClick={() => {}} funnelTotals={{}} />);

    expect(screen.getByText('Deleted account')).toBeTruthy();
    expect(screen.getByText('DELETED')).toBeTruthy();
    expect(screen.getByText('$3.99')).toBeTruthy();
    expect(screen.queryByTitle('Log in as this user')).toBeNull();
    expect(screen.queryByTitle('Grant credits')).toBeNull();
    expect(screen.queryByTitle('Mark as test account')).toBeNull();
    expect(screen.queryByTitle('View journey')).toBeNull();
  });
});

describe('UserTable origin badge (T16900)', () => {
  it.each(['organic', 'direct', 'other-website'])('shows no-source origin %s in green', (origin) => {
    render(<UserTable users={[{ ...BASE_USER, origin }]} onUserClick={() => {}} funnelTotals={{}} />);
    expect(screen.getByTitle(origin).className).toContain('text-green-400');
  });

  it('shows a sourced origin in blue', () => {
    render(<UserTable users={[{ ...BASE_USER, origin: 'seo' }]} onUserClick={() => {}} funnelTotals={{}} />);
    expect(screen.getByTitle('seo').className).toContain('text-blue-400');
  });
});

describe('UserTable users total (T17150)', () => {
  it('counts deleted payer rows apart so a filter never raises the users total', () => {
    // Staging: Paying listed 3 live payers + 10 deleted payers and read "13 users total"
    // against 10 unfiltered.
    useAdminStore.setState({ totalUsers: 13, deletedUsers: 10 });
    render(<UserTable users={[BASE_USER]} onUserClick={() => {}} funnelTotals={{}} />);
    expect(screen.getByText(/3 users total · 10 deleted accounts/)).toBeTruthy();
    expect(screen.queryByText(/13 users total/)).toBeNull();
  });

  it('shows no deleted part when the list has none', () => {
    useAdminStore.setState({ totalUsers: 10, deletedUsers: 0 });
    render(<UserTable users={[BASE_USER]} onUserClick={() => {}} funnelTotals={{}} />);
    expect(screen.getByText(/10 users total/)).toBeTruthy();
    expect(screen.queryByText(/deleted accounts/)).toBeNull();
  });
});
