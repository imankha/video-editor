import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { UploadFailuresPanel } from './UploadFailuresPanel';

const RESPONSE = {
  window: { since_build: 4812, commit_sha: 'abc1234', since_date: '2026-09-16',
            until_date: '2026-09-17', rows_at_this_build: 2 },
  rows: [
    { id: 1, occurred_at: '2026-09-17T10:00:00Z', kind: 'game', stage: 'preparing',
      reason: 'refused', user_id: 'user-a', origin: 'server', terminal: true,
      original_filename: 'clip.mp4' },
  ],
  total: 1,
  rates: {
    game: { attempts: 5, succeeded: 4, failed: 1, rate_pct: 80.0 },
    clip: { attempts: 0, succeeded: 0, failed: 0, rate_pct: null,
            denominator_note: 'outcome-based: clip_upload_attempted is not emitted yet (T8380)' },
  },
};

describe('UploadFailuresPanel (T10270) -- pure view', () => {
  it('renders a Load button and no table before a fetch', () => {
    render(<UploadFailuresPanel data={null} loading={false} error={null} onRefresh={vi.fn()} />);
    expect(screen.getByText('Load upload failures')).toBeTruthy();
    expect(screen.queryByText('user-a')).toBeNull();
  });

  it('calls onRefresh when the button is clicked', () => {
    const onRefresh = vi.fn();
    render(<UploadFailuresPanel data={null} loading={false} error={null} onRefresh={onRefresh} />);
    fireEvent.click(screen.getByText('Load upload failures'));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('renders game and clip rates SEPARATELY, never summed, and shows the clip denominator note', () => {
    render(<UploadFailuresPanel data={RESPONSE} loading={false} error={null} onRefresh={vi.fn()} />);
    expect(screen.getByText('Game Upload Rate')).toBeTruthy();
    expect(screen.getByText('Clip Upload Rate')).toBeTruthy();
    expect(screen.getByText('80%')).toBeTruthy();
    expect(screen.getByText('4/5 succeeded (1 failed)')).toBeTruthy();
    expect(screen.getByText(/clip_upload_attempted is not emitted yet/)).toBeTruthy();
  });

  it('renders "--" for a rate with zero attempts, not a misleading 0%', () => {
    render(<UploadFailuresPanel data={RESPONSE} loading={false} error={null} onRefresh={vi.fn()} />);
    expect(screen.getByText('--')).toBeTruthy();
    expect(screen.getByText('0/0 succeeded (0 failed)')).toBeTruthy();
  });

  it('renders the row list with filename and user', () => {
    render(<UploadFailuresPanel data={RESPONSE} loading={false} error={null} onRefresh={vi.fn()} />);
    expect(screen.getByText('user-a')).toBeTruthy();
    expect(screen.getByText('clip.mp4')).toBeTruthy();
    expect(screen.getByText('refused')).toBeTruthy();
  });

  it('shows the migrated:false message instead of an empty table', () => {
    render(<UploadFailuresPanel data={{ migrated: false }} loading={false} error={null} onRefresh={vi.fn()} />);
    expect(screen.getByText(/Not migrated yet/)).toBeTruthy();
  });

  it('shows the error message when present', () => {
    render(<UploadFailuresPanel data={null} loading={false} error="Admin access required" onRefresh={vi.fn()} />);
    expect(screen.getByText('Error: Admin access required')).toBeTruthy();
  });
});
