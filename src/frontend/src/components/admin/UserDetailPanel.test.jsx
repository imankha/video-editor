import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { UserDetailPanel } from './UserDetailPanel';

const BASE_DATA = {
  email: 'bigajosue@test.com',
  origin: 'organic',
  session_count: 2,
  acquired_at: '2026-08-20',
  last_active_at: '2026-08-21T00:00:00Z',
  actionLog: [],
};

describe('UserDetailPanel attempted vs succeeded (T7510)', () => {
  it('renders the attempt/success gap and failure reasons for a failed-upload user', () => {
    const data = {
      ...BASE_DATA,
      milestones: [
        { event: 'game_created', at: '2026-08-20T10:00:00Z', count: 4 },
        {
          event: 'game_upload_failed',
          at: '2026-08-20T10:01:00Z',
          count: 0,
          failed_count: 4,
          failures: { timeout: 3, network: 1 },
        },
      ],
    };
    render(<UserDetailPanel data={data} onClose={() => {}} />);

    // 0 succeeded out of 4 attempted, gap surfaced.
    expect(screen.getByText('0')).toBeTruthy();
    expect(screen.getByText('4')).toBeTruthy();
    expect(screen.getByText('(-4)')).toBeTruthy();
    expect(screen.getByText('[timeout x3, network x1]')).toBeTruthy();
  });

  it('renders annotation_completed under Engagement, not the content-outcome pipeline', () => {
    const data = {
      ...BASE_DATA,
      milestones: [
        { event: 'annotation_completed', at: '2026-08-20T10:05:00Z', count: 1 },
      ],
    };
    render(<UserDetailPanel data={data} onClose={() => {}} />);
    expect(screen.getByText('Engagement')).toBeTruthy();
    expect(screen.getByText('Annotate')).toBeTruthy();
  });

  it('renders a retry-burst badge when frustration_signals carries one', () => {
    const data = {
      ...BASE_DATA,
      milestones: [],
      frustration_signals: {
        retry_bursts: {
          game_created: [{ count: 4, window_start: 't0', window_end: 't1' }],
        },
      },
    };
    render(<UserDetailPanel data={data} onClose={() => {}} />);
    expect(screen.getByText('Retry Burst')).toBeTruthy();
    expect(screen.getByText('game_created x4')).toBeTruthy();
  });

  it('omits the retry-burst badge when there are no bursts', () => {
    const data = { ...BASE_DATA, milestones: [] };
    render(<UserDetailPanel data={data} onClose={() => {}} />);
    expect(screen.queryByText('Retry Burst')).toBeNull();
  });

  it('returns null when data is absent', () => {
    const { container } = render(<UserDetailPanel data={null} onClose={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });
});

describe('UserDetailPanel clip-phase inventory (T7860)', () => {
  const CLIP_PHASES = {
    clips: { created: 5, focus_started: 3, focused: 2 },
    reels: { completed: 1, published: 2 },
    flags: { intro_explicit: 1, intro_inherited: 1, downloaded: 2, shared: 1, watched: 3 },
  };

  it('renders clip and reel tier counts plus reel flags when clipPhases is present', () => {
    const data = { ...BASE_DATA, milestones: [], clipPhases: CLIP_PHASES };
    render(<UserDetailPanel data={data} onClose={() => {}} />);
    expect(screen.getByText('Clip Phases')).toBeTruthy();
    // Tier labels
    expect(screen.getByText('Clips')).toBeTruthy();
    expect(screen.getByText('Reels')).toBeTruthy();
    // A bucket count and a flag label render
    expect(screen.getByText('Focused')).toBeTruthy();
    expect(screen.getByText('Published')).toBeTruthy();
    expect(screen.getByText('Reel flags')).toBeTruthy();
    expect(screen.getByText('Shared')).toBeTruthy();
  });

  it('omits the phase breakdown when clipPhases is absent (best-effort read failed)', () => {
    const data = { ...BASE_DATA, milestones: [] };
    render(<UserDetailPanel data={data} onClose={() => {}} />);
    expect(screen.queryByText('Clip Phases')).toBeNull();
  });
});
