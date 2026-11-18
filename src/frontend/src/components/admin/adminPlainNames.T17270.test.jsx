import { render, screen, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { UserTable } from './UserTable';
import { UserDetailPanel } from './UserDetailPanel';
import { PackMixTable } from './PackMixTable';

// T17270: the admin panel uses the names parents see and one local date format.

const LOCAL = (iso) => new Date(iso).toLocaleString('en-US', {
  month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
});

const USER = {
  user_id: 'u1', email: 'user@test.com', origin: 'organic', last_step: 'Focus Exported',
  acquired_at: '2026-11-17', joined_at: '2026-11-17T22:25:00+00:00',
  clip_created_count: 3, clip_tried_count: 3, clip_succeeded_count: 3,
  export_completed_count: 4, framing_exported_count: 3, overlay_exported_count: 1,
  highlight_finished_count: 3, share_completed_count: 0, credits: 0, total_spent_cents: 0,
  action_count: 0, session_count: 2, total_usage_seconds: 0, avg_weekly_seconds: 0,
  last_7d_seconds: 0, last_active_at: '2026-11-18T01:05:00+00:00',
};

describe('T17270 UserTable plain names', () => {
  it('columns are Plays, Sharpens, Spotlights, Highlights; no internal names; no double-counted Exports', () => {
    render(<UserTable users={[USER]} onUserClick={() => {}} funnelTotals={{}} />);
    const headers = screen.getAllByRole('columnheader').map((th) => th.textContent.trim());
    for (const name of ['Plays', 'Sharpens', 'Spotlights', 'Highlights']) expect(headers).toContain(name);
    for (const h of headers) expect(h).not.toMatch(/clips|focus|overlay|exports|project-manager/i);
    const cells = screen.getAllByRole('cell').map((td) => td.textContent.trim());
    expect(cells).not.toContain('4'); // the 4-renders-for-3-highlights total is gone
    expect(screen.getByText('Sharpened')).toBeTruthy(); // last step badge, not "Focus Exported"
    expect(screen.queryByText(/Focus|Overlay/)).toBeNull();
  });

  it('Joined and Last active share one local format', () => {
    render(<UserTable users={[USER]} onUserClick={() => {}} funnelTotals={{}} />);
    expect(screen.getByText(LOCAL(USER.joined_at))).toBeTruthy();
    expect(screen.getByText(LOCAL(USER.last_active_at))).toBeTruthy();
  });

  it('a test account with no tracking says so instead of blank cells', () => {
    const t = { ...USER, is_test_account: true, joined_at: null, last_active_at: null, session_count: 0 };
    render(<UserTable users={[t]} onUserClick={() => {}} funnelTotals={{}} />);
    expect(screen.getByText('Test sign-in, sessions not tracked')).toBeTruthy();
  });
});

describe('T17270 UserDetailPanel plain names', () => {
  const data = {
    email: 'user@test.com', origin: 'organic', session_count: 2, milestones: [], actionLog: [],
    acquired_at: '2026-11-17', joined_at: USER.joined_at, last_active_at: USER.last_active_at,
    session_exits: [{ at: '2026-11-17T23:00:00Z', last_screen: 'overlay',
      dwell: { annotate: 12.5, framing: 80 }, trail: ['project-manager', 'annotate', 'framing', 'overlay'] }],
  };

  it('journey trail uses the step names parents see', () => {
    render(<UserDetailPanel data={data} onClose={() => {}} />);
    const trail = screen.getByTestId('session-exit-trail').textContent;
    expect(trail).toContain('trail Home > Mark Plays > Zoom in > Spotlight');
    expect(trail).toContain('left on Spotlight');
    expect(trail).toContain('Zoom in 80s');
    expect(trail).not.toMatch(/project-manager|framing|overlay|annotate/);
  });

  it('header line shows Joined and Last active in the same local format', () => {
    render(<UserDetailPanel data={data} onClose={() => {}} />);
    const line = screen.getByText(/Joined/).textContent;
    expect(line).toContain(`Joined ${LOCAL(USER.joined_at)}`);
    expect(line).toContain(`Last active ${LOCAL(USER.last_active_at)}`);
  });
});

describe('T17270 PackMixTable names match checkout', () => {
  it('the 150-credit pack reads "Starter (150 credits)", as in the buy window', () => {
    const d = { windows: { '30d': [{ pack: 'starter', purchases: 1, gross_cents: 699 }], '90d': [], all: [] } };
    render(<PackMixTable data={d} loading={false} error={null} onRefresh={vi.fn()} />);
    const w = within(screen.getByTestId('pack-mix-30d'));
    expect(w.getByText('Starter (150 credits)')).toBeTruthy();
    expect(w.queryByText(/One Game/)).toBeNull();
  });
});
