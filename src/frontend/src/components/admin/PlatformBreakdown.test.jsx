import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { PlatformBreakdown } from './PlatformBreakdown';

describe('PlatformBreakdown tries vs succeeded (T8220)', () => {
  it('shows Games Tried and Games Succeeded as distinct rows, never one "Games Uploaded" bound to the attempt count', () => {
    const data = {
      total_users: 10,
      total_actions: 20,
      platforms: [
        { platform: 'webapp-desktop', users: 10, actions: 20 },
      ],
      by_action: [
        {
          action: 'game_created',
          platforms: [{ platform: 'webapp-desktop', users: 10, count: 7 }],
        },
        {
          action: 'game_upload_succeeded',
          platforms: [{ platform: 'webapp-desktop', users: 1, count: 1 }],
        },
      ],
    };
    render(<PlatformBreakdown data={data} />);

    expect(screen.getByText('Games Tried')).toBeTruthy();
    expect(screen.getByText('Games Succeeded')).toBeTruthy();
    expect(screen.queryByText('Games Uploaded')).toBeNull();
  });

  it('surfaces the chenyh1225 shape: 7 tries, 0 succeeded, so the succeeded row totals 0 (dropped from the table, not conflated with tries)', () => {
    const data = {
      total_users: 1,
      total_actions: 7,
      platforms: [
        { platform: 'webapp-mobile', users: 1, actions: 1 },
        { platform: 'webapp-desktop', users: 1, actions: 4 },
        { platform: 'pwa-desktop', users: 1, actions: 2 },
      ],
      // The real chenyh1225 account never emitted a single game_upload_succeeded
      // row, so by_action (grouped straight from user_actions) never contains
      // that action at all -- there is no zero-count row to render or drop.
      by_action: [
        {
          action: 'game_created',
          platforms: [
            { platform: 'webapp-mobile', users: 1, count: 1 },
            { platform: 'webapp-desktop', users: 1, count: 4 },
            { platform: 'pwa-desktop', users: 1, count: 2 },
          ],
        },
      ],
    };
    render(<PlatformBreakdown data={data} />);

    expect(screen.getByText('Games Tried')).toBeTruthy();
    expect(screen.getByText('7')).toBeTruthy();
    expect(screen.queryByText('Games Succeeded')).toBeNull();
  });
});
